import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Ledger Check",
  description: "The terms for using Ledger Check.",
};

const LAST_UPDATED = "August 7, 2026";
const CONTACT_EMAIL = "tanush.yarram@gmail.com";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 text-sm leading-relaxed text-slate-700">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Terms of Service
        </h1>
        <p className="mt-1 text-xs text-slate-400">Last updated {LAST_UPDATED}</p>
      </div>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
        <p>
          Ledger Check is an early-stage, single-developer project. These
          terms describe how the app actually works today, in plain language
          — they have not been reviewed by an attorney and need real legal
          review before Ledger Check is marketed to the public. By using
          Ledger Check, you agree to what&apos;s described below.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">
          What Ledger Check is — and isn&apos;t
        </h2>
        <p>
          Ledger Check is an informational tool that helps you review a
          potential trade before you make it: sector concentration, wash-sale
          exposure, estimated tax impact, and a portfolio health score,
          computed from data you provide or sync from a linked brokerage
          account.
        </p>
        <p>
          Ledger Check <strong>does not execute trades</strong>. It has no
          connection to any brokerage that can buy or sell on your behalf —
          every trade you make happens on your actual broker&apos;s platform,
          entirely outside this app. Ledger Check also does not provide tax
          advice or investment advice, and nothing it shows you — including
          the AI-generated digest and trade review — is a recommendation to
          buy or sell any security. See the{" "}
          <Link href="/settings" className="underline hover:text-slate-900">
            Disclaimer &amp; settings
          </Link>{" "}
          page for the specific calculations and their known limitations.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Your account</h2>
        <p>
          You&apos;re responsible for the accuracy of the data you enter or
          import, and for keeping access to your email (Ledger Check&apos;s
          only sign-in method) secure. If you link a brokerage account, you
          represent that you&apos;re authorized to connect it.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">
          Brokerage connections
        </h2>
        <p>
          Brokerage sync is currently gated to SnapTrade&apos;s sandbox
          environment — only simulated test accounts can be linked, not real
          brokerages, until SnapTrade approves a production key. Once real
          brokerage connections are supported, sync accuracy depends on data
          SnapTrade returns from your broker; Ledger Check isn&apos;t
          responsible for errors or gaps in that upstream data (see the known
          limitations on the Disclaimer &amp; settings page for how a
          synced account with incomplete history is handled).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">
          No warranty, use at your own risk
        </h2>
        <p>
          Ledger Check is provided &ldquo;as is,&rdquo; without warranty of
          any kind. It&apos;s a young, actively-changing project — features
          can have bugs, and calculations, while computed deterministically
          rather than guessed by an AI, can still be wrong due to a bug,
          missing data, or a limitation described on the Disclaimer &amp;
          settings page. Always verify tax and wash-sale outcomes with your
          broker&apos;s official records and a qualified tax professional
          before filing or making a financial decision. To the fullest extent
          the law allows, Ledger Check and its operator aren&apos;t liable
          for any financial loss, tax consequence, or damages arising from
          your use of the app.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Acceptable use</h2>
        <p>
          Don&apos;t use Ledger Check to attempt unauthorized access to
          another user&apos;s data, to disrupt the service, or to connect a
          brokerage account you&apos;re not authorized to access.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">
          Changes and availability
        </h2>
        <p>
          As a single-developer, early-stage project, Ledger Check&apos;s
          features, these terms, and the service&apos;s availability can
          change with little notice. If these terms change materially,
          this page&apos;s date will be updated.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Your data</h2>
        <p>
          See the{" "}
          <Link href="/privacy" className="underline hover:text-slate-900">
            Privacy Policy
          </Link>{" "}
          for what&apos;s collected, who it&apos;s shared with, and how to
          request deletion.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Contact</h2>
        <p>
          Questions about these terms:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline hover:text-slate-900">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
