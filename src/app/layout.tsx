import type { Metadata } from "next";
import "./globals.css";
import { AppNav } from "@/components/app-nav";

export const metadata: Metadata = {
  title: "Fantasy War Room",
  description: "Evidence-backed fantasy football decisions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <main className="shell">{children}</main>
        <AppNav />
      </body>
    </html>
  );
}
