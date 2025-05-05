"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { GoogleGenerativeAI } from "@google/generative-ai";
import aj from "@/lib/arcjet";
import { request } from "@arcjet/next";

// Instantiate the Gemini API using the environment variable
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper to serialize transaction amounts
const serializeAmount = (obj) => ({
  ...obj,
  amount: obj.amount.toNumber(),
});

// Create Transaction
export async function createTransaction(data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    // Get request data for ArcJet
    const req = await request();

    // Check rate limit using ArcJet
    const decision = await aj.protect(req, {
      userId,
      requested: 1, // Specify how many tokens to consume
    });

    if (decision.isDenied()) {
      if (decision.reason.isRateLimit()) {
        const { remaining, reset } = decision.reason;
        console.error({
          code: "RATE_LIMIT_EXCEEDED",
          details: { remaining, resetInSeconds: reset },
        });
        throw new Error("Too many requests. Please try again later.");
      }
      throw new Error("Request blocked");
    }

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    const account = await db.account.findUnique({
      where: { id: data.accountId, userId: user.id },
    });
    if (!account) throw new Error("Account not found");

    // Calculate new balance: subtract expenses, add income
    const balanceChange = data.type === "EXPENSE" ? -data.amount : data.amount;
    const newBalance = account.balance.toNumber() + balanceChange;

    // Create transaction and update account balance atomically
    const transaction = await db.$transaction(async (tx) => {
      const newTransaction = await tx.transaction.create({
        data: {
          ...data,
          userId: user.id,
          nextRecurringDate:
            data.isRecurring && data.recurringInterval
              ? calculateNextRecurringDate(data.date, data.recurringInterval)
              : null,
        },
      });

      await tx.account.update({
        where: { id: data.accountId },
        data: { balance: newBalance },
      });

      return newTransaction;
    });

    revalidatePath("/dashboard");
    revalidatePath(`/account/${transaction.accountId}`);

    return { success: true, data: serializeAmount(transaction) };
  } catch (error) {
    throw new Error(error.message);
  }
}

// Get a single transaction by id
export async function getTransaction(id) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });
  if (!user) throw new Error("User not found");

  const transaction = await db.transaction.findUnique({
    where: { id, userId: user.id },
  });
  if (!transaction) throw new Error("Transaction not found");

  return serializeAmount(transaction);
}

// Update Transaction
export async function updateTransaction(id, data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    // Get the original transaction to calculate balance changes
    const originalTransaction = await db.transaction.findUnique({
      where: { id, userId: user.id },
      include: { account: true },
    });
    if (!originalTransaction) throw new Error("Transaction not found");

    const oldBalanceChange =
      originalTransaction.type === "EXPENSE"
        ? -originalTransaction.amount.toNumber()
        : originalTransaction.amount.toNumber();

    const newBalanceChange = data.type === "EXPENSE" ? -data.amount : data.amount;
    const netBalanceChange = newBalanceChange - oldBalanceChange;

    // Update transaction and account balance atomically
    const transaction = await db.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
        where: { id, userId: user.id },
        data: {
          ...data,
          nextRecurringDate:
            data.isRecurring && data.recurringInterval
              ? calculateNextRecurringDate(data.date, data.recurringInterval)
              : null,
        },
      });

      await tx.account.update({
        where: { id: data.accountId },
        data: { balance: { increment: netBalanceChange } },
      });

      return updated;
    });

    revalidatePath("/dashboard");
    revalidatePath(`/account/${data.accountId}`);

    return { success: true, data: serializeAmount(transaction) };
  } catch (error) {
    throw new Error(error.message);
  }
}

// Get all transactions for a user
export async function getUserTransactions(query = {}) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    const transactions = await db.transaction.findMany({
      where: { userId: user.id, ...query },
      include: { account: true },
      orderBy: { date: "desc" },
    });

    return { success: true, data: transactions };
  } catch (error) {
    throw new Error(error.message);
  }
}

// Scan Receipt: extract transaction details from a receipt image using AI
export async function scanReceipt(file) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is missing or invalid. Skipping receipt scan.");
      return { amount: 0, date: new Date(), description: "", merchantName: "", category: "" };
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const arrayBuffer = await file.arrayBuffer();
    const base64String = Buffer.from(arrayBuffer).toString("base64");

    const prompt = `
      Analyze this receipt image and extract the following information in JSON format:
      - Total amount (just the number)
      - Date (in ISO format)
      - Description or items purchased (brief summary)
      - Merchant/store name
      - Suggested category (one of: housing,transportation,groceries,utilities,entertainment,food,shopping,healthcare,education,personal,travel,insurance,gifts,bills,other-expense )
      
      Only respond with valid JSON in this exact format:
      {
        "amount": number,
        "date": "ISO date string",
        "description": "string",
        "merchantName": "string",
        "category": "string"
      }
      
      If its not a recipt, return an empty object
    `;

    const result = await model.generateContent([
      { inlineData: { data: base64String, mimeType: file.type } },
      prompt,
    ]);

    const response = await result.response;
    const text = response.text();
    const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();

    try {
      const data = JSON.parse(cleanedText);
      return {
        amount: parseFloat(data.amount),
        date: new Date(data.date),
        description: data.description,
        category: data.category,
        merchantName: data.merchantName,
      };
    } catch (parseError) {
      console.error("Error parsing JSON response:", parseError);
      throw new Error("Invalid response format from Gemini");
    }
  } catch (error) {
    console.error("Error scanning receipt:", error);
    throw new Error("Failed to scan receipt");
  }
}

// Scan Payslip: extract income transaction details from a payslip document using AI
export async function scanPayslip(file) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is missing or invalid. Skipping payslip scan.");
      return { amount: 0, date: new Date(), employerName: "", description: "", category: "income" };
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const arrayBuffer = await file.arrayBuffer();
    const base64String = Buffer.from(arrayBuffer).toString("base64");

    const prompt = `
      Analyze this payslip document and extract the following information in JSON format:
      - Net salary amount (just the number)
      - Payment date (in ISO format)
      - Employer name (string)
      - A brief description (e.g., "Salary for [month]")
      - Category (must be exactly one of these: salary, bonus, commission, overtime)

      Rules for categorization:
      - Use "salary" for regular monthly/weekly base salary
      - Use "bonus" for performance bonuses or annual bonuses
      - Use "commission" for sales commissions
      - Use "overtime" for overtime payments

      Only respond with valid JSON in this exact format:
      {
        "amount": number,
        "date": "ISO date string",
        "employerName": "string",
        "description": "string",
        "category": "string"
      }
    `;

    const result = await model.generateContent([
      { inlineData: { data: base64String, mimeType: file.type } },
      prompt,
    ]);

    const response = await result.response;
    const text = response.text();
    const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();

    try {
      const data = JSON.parse(cleanedText);
      // Add debug logging
      console.log("AI Response:", data);
      
      return {
        amount: parseFloat(data.amount),
        date: new Date(data.date),
        employerName: data.employerName,
        description: data.description,
        category: data.category.toLowerCase(), // Ensure lowercase for consistency
      };
    } catch (parseError) {
      console.error("Error parsing JSON response from payslip:", parseError);
      throw new Error("Invalid response format from Gemini for payslip");
    }
  } catch (error) {
    console.error("Error scanning payslip:", error);
    throw new Error("Failed to scan payslip");
  }
}

// Create Payslip Transaction: process an uploaded payslip and create an income transaction
export async function createPayslipTransaction(file, accountId) {
  try {
    const payslipData = await scanPayslip(file);
    console.log("Payslip data received:", payslipData); // Debug log

    const transactionData = {
      accountId,
      type: "INCOME",
      amount: payslipData.amount,
      date: payslipData.date,
      description: payslipData.description || `Salary received from ${payslipData.employerName}`,
      category: payslipData.category // Use the category from AI
    };

    console.log("Creating transaction with data:", transactionData); // Debug log

    const result = await createTransaction(transactionData);
    return result;
  } catch (error) {
    console.error("Error creating payslip transaction:", error);
    throw new Error("Failed to create payslip transaction");
  }
}

// Helper function: calculate the next recurring date based on an interval
function calculateNextRecurringDate(startDate, interval) {
  const date = new Date(startDate);
  switch (interval) {
    case "DAILY":
      date.setDate(date.getDate() + 1);
      break;
    case "WEEKLY":
      date.setDate(date.getDate() + 7);
      break;
    case "MONTHLY":
      date.setMonth(date.getMonth() + 1);
      break;
    case "YEARLY":
      date.setFullYear(date.getFullYear() + 1);
      break;
  }
  return date;
}
