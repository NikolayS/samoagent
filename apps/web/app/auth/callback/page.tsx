"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MagicLinkCallback } from "../../../components/MagicLinkCallback.tsx";
import { AppShell } from "../../../components/AppShell.tsx";
import { createHttpAppApiClient } from "../../../lib/appApiClient.ts";

const client = createHttpAppApiClient();

function CallbackInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? undefined;
  return <MagicLinkCallback token={token} client={client} />;
}

export default function AuthCallbackPage() {
  return (
    <AppShell variant="public" pageClassName="samograph-page--form">
      <Suspense fallback={<p>Loading…</p>}>
        <CallbackInner />
      </Suspense>
    </AppShell>
  );
}
