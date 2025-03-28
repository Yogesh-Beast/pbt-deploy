import { Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/header";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from 'sonner';

// Initialize the Google Font
const inter = Inter({ subsets: ["latin"] });

// Metadata for the page
export const metadata = {
  title: "Personal Budget Tracker",
  description: "Control your finances with ease",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          <title>{metadata.title}</title>
          <meta name="description" content={metadata.description} />
        </head>
        <body className={inter.className}>
          <Header />
          <main className="min-h-screen">
            {children}
          </main>
          <Toaster richColors />
          <footer className="bg-blue-50 py-12">
            <div className="container mx-auto px-4 text-center text-gray-600">
              <p>
                Made with <span>❤️</span> by Yogesh Shrestha
              </p>
            </div>
          </footer>
        </body>
      </html>
    </ClerkProvider>
  );
}
