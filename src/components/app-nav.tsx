"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleGauge, ListChecks, Search, ShieldPlus, Sparkles } from "lucide-react";

const items = [
  { href: "/today", label: "Today", icon: Sparkles },
  { href: "/draft", label: "Draft", icon: CircleGauge },
  { href: "/lineup", label: "Lineup", icon: ListChecks },
  { href: "/waivers", label: "Waivers", icon: ShieldPlus },
  { href: "/players", label: "Players", icon: Search },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="glass"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 18,
        transform: "translateX(-50%)",
        zIndex: 20,
        width: "min(680px, calc(100% - 22px))",
        borderRadius: 999,
        padding: 7,
        display: "grid",
        gridTemplateColumns: "repeat(5,1fr)",
        gap: 4,
      }}
    >
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (pathname === "/" && href === "/today");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              minHeight: 44,
              borderRadius: 999,
              background: active ? "var(--text)" : "transparent",
              color: active ? "var(--bg)" : "var(--muted)",
              fontSize: 13,
              fontWeight: 650,
            }}
          >
            <Icon size={17} strokeWidth={2} />
            <span className="nav-label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
