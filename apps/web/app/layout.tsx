import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./globals.css";

const themeBootScript = `(function(){try{var t=localStorage.getItem("samograph-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;else document.documentElement.removeAttribute("data-theme")}catch(e){}})()`;

export const metadata: Metadata = {
  title: "samograph — live transcripts for your calls",
  description:
    "Zero-setup live transcripts for your Zoom and Google Meet calls. Sign in, add a meeting link, watch it stream live, then share read-only or download.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      {/*
        Issue #70: browser extensions (Grammarly, ColorZilla, password managers)
        stamp attributes onto <body> before React hydrates, which trips the
        "attributes of the server rendered HTML didn't match" warning. The body
        suppression stays narrow; the html element is also suppressed because
        the no-flash theme script intentionally sets its data-theme before React
        hydrates. Real mismatches inside the app still surface.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
