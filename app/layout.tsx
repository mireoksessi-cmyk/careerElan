import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LoginManager } from "@/lib/auth/LoginManager";
import CareerAssistant from "@/components/chatbot/CareerAssistant";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Career Élan",
  description: "AI Career Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
     <body className="flex min-h-full flex-col">
  <ToastProvider>
    <ConfirmDialogProvider>
      <LoginManager>
        {children}

        <CareerAssistant />
      </LoginManager>
    </ConfirmDialogProvider>
  </ToastProvider>
</body>
    </html>
  );
}