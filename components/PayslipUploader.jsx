"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button"; // Your UI button component
import { toast } from "sonner";
import { scanPayslip } from "@/actions/transaction"; // Use scanPayslip to get the scanned data

/**
 * PayslipUploader Component
 *
 * Props:
 * - onScanComplete: Callback function to pass scanned payslip data to the parent form.
 * - className: Optional additional classes for the outer wrapper.
 */
export function PayslipUploader({ onScanComplete, className = "" }) {
  const fileInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const scannedData = await scanPayslip(file);
      console.log("Scanned payslip data:", scannedData);
      toast.success("Payslip scanned successfully");
      
      if (onScanComplete) onScanComplete(scannedData);
    } catch (error) {
      console.error("Error scanning payslip:", error);
      toast.error("Error scanning payslip. Please try again.");
    }
  };

  return (
    <div className={`w-full ${className}`}>
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      {/* IMPORTANT: Set type="button" so that this button does not submit the form */}
      <Button
        type="button"
        onClick={() => fileInputRef.current && fileInputRef.current.click()}
        className="w-full h-10 bg-gradient-to-br from-blue-600 to-purple-600"
      >
        Upload Payslip
      </Button>
    </div>
  );
}
