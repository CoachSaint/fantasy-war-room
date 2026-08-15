import type { Metadata } from "next";
import "./globals.css";
import { AppNav } from "@/components/app-nav";
import { CoachBot } from "@/components/coach-bot";
import { ManagerContext } from "@/components/manager-context";

export const metadata: Metadata = {
  title: "Fantasy War Room — Evidence-Backed League Intelligence",
  description: "League-aware fantasy football decision assistant built around four high-value workflows: Today, Draft, Lineup, Waivers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <main className="shell">
          <ManagerContext />
          {children}
        </main>
        <CoachBot />
        <AppNav />
      </body>
    </html>
  );
}
