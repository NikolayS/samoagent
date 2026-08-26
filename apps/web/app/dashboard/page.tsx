"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Dashboard } from "../../components/Dashboard.tsx";
import { AppShell } from "../../components/AppShell.tsx";
import { createHttpAppApiClient } from "../../lib/appApiClient.ts";

const client = createHttpAppApiClient();

function DashboardInner() {
  const router = useRouter();
  const params = useSearchParams();
  // Story-4: a COULD_NOT_JOIN "Try again" returns here with the original URL so
  // the owner can edit + explicitly re-submit (no auto-create — §5.2).
  const initialUrl = params.get("url") ?? undefined;
  return (
    <Dashboard
      client={client}
      redirect={(path) => router.replace(path)}
      initialUrl={initialUrl}
    />
  );
}

export default function DashboardPage() {
  const router = useRouter();
  return (
    <AppShell client={client} redirect={(path) => router.replace(path)}>
      {/* useSearchParams requires a Suspense boundary (App Router CSR bailout). */}
      <Suspense fallback={<p>Loading…</p>}>
        <DashboardInner />
      </Suspense>
    </AppShell>
  );
}
