import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ledger Check",
  description:
    "A plain-English gut check on sector concentration and wash sales before you trade.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email as string | undefined;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Ledger Check
            </Link>
            {email && (
              <div className="flex gap-4 text-sm text-slate-600">
                <Link href="/" className="hover:text-slate-900">
                  Dashboard
                </Link>
                <Link href="/holdings" className="hover:text-slate-900">
                  Holdings
                </Link>
                <Link href="/simulate" className="hover:text-slate-900">
                  Trade check
                </Link>
                <Link href="/settings" className="hover:text-slate-900">
                  Disclaimer &amp; settings
                </Link>
              </div>
            )}
            <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
              {email ? (
                <>
                  <span>{email}</span>
                  <form action="/auth/signout" method="post">
                    <button
                      type="submit"
                      className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-100"
                    >
                      Sign out
                    </button>
                  </form>
                </>
              ) : (
                <span>Informational only — not tax advice</span>
              )}
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-400">
          Ledger Check is an informational gut-check, not tax or investment
          advice.{" "}
          <Link href="/settings" className="underline hover:text-slate-600">
            Read the full disclaimer
          </Link>
          .
        </footer>
      </body>
    </html>
  );
}
