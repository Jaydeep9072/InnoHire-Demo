import type { Metadata } from "next";
import { Montserrat, Poppins } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-heading", display: "swap" });
const poppins = Poppins({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "InnoHire — Talent operations",
    template: "%s | InnoHire",
  },
  description: "Create jobs, identify strong candidates, and track hiring outcomes.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className={`${montserrat.variable} ${poppins.variable}`}><AppShell>{children}</AppShell></body>
    </html>
  );
}
