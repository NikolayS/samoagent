import type { ReactNode } from "react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const jetBrainsMono = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jetbrains-mono-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/jetbrains-mono-700-latin.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-jetbrains",
  display: "swap",
});

const themeBootScript = `(function(){try{var t=localStorage.getItem("samograph-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;else document.documentElement.removeAttribute("data-theme")}catch(e){}})()`;

export const metadata: Metadata = {
  title: "samograph — live transcripts for your calls",
  description:
    "Zero-setup live transcripts for your Zoom and Google Meet calls. Sign in, add a meeting link, watch it stream live, then share read-only or download.",
  icons: { icon: "/robot-mark.png" },
  openGraph: {
    title: "samograph — live transcripts for your calls",
    description:
      "Zero-setup live transcripts for your Zoom and Google Meet calls. Sign in, add a meeting link, watch it stream live, then share read-only or download.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
      <body className={jetBrainsMono.variable} suppressHydrationWarning>{children}</body>
    </html>
  );
}
