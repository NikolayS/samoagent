"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { AppApiClient } from "../lib/appApiClient.ts";
import { AccountEmail } from "./AccountEmail.tsx";
import { LogoutButton } from "./LogoutButton.tsx";
import { ThemeSwitcher } from "./ThemeSwitcher.tsx";
import { ShortcutHint } from "./ShortcutHint.tsx";
import { useShortcuts } from "./useShortcuts.tsx";

export interface AppShellProps {
  client?: AppApiClient;
  redirect?: (path: string) => void;
  variant?: "app" | "public";
  pageClassName?: string;
  children: ReactNode;
}

export function AppShell({
  client,
  redirect,
  variant = "app",
  pageClassName,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  useShortcuts({
    navigate: (path) => {
      if (variant !== "app") return;
      if (redirect) redirect(path);
      else window.location.assign(path);
    },
    onHelp: () => { if (variant === "app") setShowShortcuts(true); },
  });

  useEffect(() => {
    if (variant !== "app" || !client) return;
    let active = true;
    client.getSettings().then(
      (snapshot) => { if (active) setAccountEmail(snapshot.signin.email || null); },
      () => { if (active) setAccountEmail(null); },
    );
    return () => { active = false; };
  }, [client, variant]);

  if (variant === "app" && !client) {
    throw new Error("AppShell requires a client for the app variant");
  }

  return (
    <>
      <a className="samograph-skip-link" href="#main">Skip to content</a>
      <header className="samograph-app-nav">
        <div className="samograph-app-nav-inner">
          <a className="samograph-app-brand" href={variant === "public" ? "/" : "/dashboard"}>samograph</a>
          {variant === "app" ? (
            <nav className="samograph-app-nav-links" aria-label="Primary">
              <a href="/dashboard" aria-current={pathname === "/dashboard" ? "page" : undefined}>Dashboard</a>
              <a href="/settings" aria-current={pathname === "/settings" ? "page" : undefined}>Settings</a>
            </nav>
          ) : null}
          <div className="samograph-app-nav-right">
            {variant === "app" ? <AccountEmail email={accountEmail} /> : null}
            <ThemeSwitcher />
            {variant === "app" ? <LogoutButton client={client!} redirect={redirect ?? (() => {})} /> : null}
          </div>
        </div>
      </header>
      <main id="main" className={`samograph-page${pageClassName ? ` ${pageClassName}` : ""}`} tabIndex={-1}>
        {children}
      </main>
      {showShortcuts ? <ShortcutHint onClose={() => setShowShortcuts(false)} /> : null}
    </>
  );
}
