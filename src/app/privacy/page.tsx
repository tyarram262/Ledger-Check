import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Ledger Check",
  description: "What Ledger Check collects, why, and who it's shared with.",
};

const LAST_UPDATED = "August 7, 2026";
const CONTACT_EMAIL = "tanush.yarram@gmail.com";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 text-sm leading-relaxed text-slate-700">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Privacy Policy
        </h1>
        <p className="mt-1 text-xs text-slate-400">Last updated {LAST_UPDATED}</p>
      </div>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
        <p>
          Ledger Check is an early-stage, single-developer project, not a law
          firm or a company with a legal department. This page describes what
          the app actually does with your data today, in plain language. It
          has not been reviewed by an attorney and should not be treated as a
          substitute for one — before Ledger Check is marketed to the public,
          this page needs real legal review, not just an accurate description
          of current behavior.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">What we collect</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Your email address</strong>, to send you a passwordless
            sign-in link. We don&apos;t collect or store a password.
          </li>
          <li>
            <strong>Portfolio data you provide</strong> — account names and
            types, holdings, cost basis, purchase dates, sale records, cash
            balances, your tax profile (filing status, income bracket, state
            tax rate), and any investment-journal notes you write. This comes
            from manual entry, CSV import, or a brokerage connection you
            choose to link (see below).
          </li>
          <li>
            <strong>Brokerage connection data</strong>, if you link an account
            via SnapTrade — an access credential SnapTrade issues for your
            linked account (not your brokerage login itself, which Ledger
            Check never sees), encrypted at rest (AES-256-GCM) before it
            touches our database, plus the holdings, cash, and trade history
            SnapTrade returns for that account.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">
          Who your data is shared with
        </h2>
        <p>
          Ledger Check doesn&apos;t sell your data, run ads, or share it with
          data brokers. It&apos;s shared only with the infrastructure
          providers the app runs on:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Supabase</strong> hosts the database, authentication, and
            the encrypted brokerage-credential storage described above.
          </li>
          <li>
            <strong>Vercel</strong> hosts and serves the application itself.
          </li>
          <li>
            <strong>SnapTrade</strong> is the brokerage-connection provider,
            if you choose to link an account — your holdings and trade
            history flow through them to reach us.
          </li>
          <li>
            <strong>Resend</strong> delivers the sign-in emails.
          </li>
          <li>
            <strong>Anthropic (Claude)</strong> powers the two AI features —
            the portfolio digest and the AI trade review. When you use either,
            a summary of your portfolio composition, tickers, dollar figures,
            computed scores, and (for trade review) any rationale you type in
            is sent to Anthropic&apos;s API to generate that summary. Your
            brokerage credentials, account numbers, and email address are
            never included in that request. See{" "}
            <a
              href="https://www.anthropic.com/legal/privacy"
              className="underline hover:text-slate-900"
              target="_blank"
              rel="noreferrer"
            >
              Anthropic&apos;s privacy policy
            </a>{" "}
            for how they handle it on their end.
          </li>
        </ul>
        <p>
          None of these providers are used to advertise to you, and Ledger
          Check has no advertising or third-party analytics/tracking
          integrated today.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Cookies</h2>
        <p>
          Ledger Check sets one cookie: the session cookie Supabase Auth uses
          to keep you signed in. There are no advertising or third-party
          tracking cookies.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">
          Your data, your control
        </h2>
        <p>
          You can disconnect a linked brokerage account at any time from the
          Holdings page — this stops future syncing and freezes the last
          synced snapshot rather than deleting it, so your historical data
          stays intact for tax and wash-sale purposes. There is no
          self-service &ldquo;delete my account&rdquo; button yet. To request
          deletion of your data, email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline hover:text-slate-900">
            {CONTACT_EMAIL}
          </a>{" "}
          and it will be handled manually.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Not financial advice</h2>
        <p>
          Nothing on this page changes what&apos;s described on the{" "}
          <Link href="/settings" className="underline hover:text-slate-900">
            Disclaimer &amp; settings
          </Link>{" "}
          page: Ledger Check is an informational tool, not tax or investment
          advice.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Changes to this policy</h2>
        <p>
          If what Ledger Check collects or who it&apos;s shared with changes,
          this page will be updated and the date at the top revised
          accordingly.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Contact</h2>
        <p>
          Questions about this policy or your data:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline hover:text-slate-900">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
