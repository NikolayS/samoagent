"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { AppApiClient } from "../lib/appApiClient.ts";
import { AccountEmail } from "./AccountEmail.tsx";
import { LogoutButton } from "./LogoutButton.tsx";
import { ThemeSwitcher } from "./ThemeSwitcher.tsx";

export interface AppShellProps {
  client?: AppApiClient;
  redirect?: (path: string) => void;
  variant?: "app" | "public";
  pageClassName?: string;
  children: ReactNode;
}

export function AppShell({
  client,
  redirect = () => {},
  variant = "app",
  pageClassName,
  children,
}: AppShellProps) {
  const [accountEmail, setAccountEmail] = useState<string | null>(null);

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
          <a className="samograph-app-brand" href="/dashboard">samograph</a>
          {variant === "app" ? (
            <nav className="samograph-app-nav-links" aria-label="Primary">
              <a href="/dashboard">Dashboard</a>
              <a href="/settings">Settings</a>
            </nav>
          ) : null}
          <div className="samograph-app-nav-right">
            {variant === "app" ? <AccountEmail email={accountEmail} /> : null}
            <ThemeSwitcher />
            {variant === "app" ? <LogoutButton client={client!} redirect={redirect} /> : null}
          </div>
        </div>
      </header>
      <main id="main" className={`samograph-page${pageClassName ? ` ${pageClassName}` : ""}`} tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
