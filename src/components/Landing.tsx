import Link from "next/link";

/**
 * Public marketing page for signed-out visitors at `/` — see
 * `src/app/page.tsx`, which renders this instead of the dashboard when
 * there's no session. Every claim below maps to a feature that ships today
 * (see CLAUDE.md's "What's built vs. the MVP"); nothing here is aspirational
 * copy for a feature that doesn't exist yet.
 */
export default function Landing() {
  return (
    <div className="space-y-16 py-8">
      <section className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Your broker won&apos;t catch the IRA wash sale. We will.
        </h1>
        <p className="mt-4 text-base text-slate-600">
          Ledger Check is a plain-English gut check before you trade. It
          checks sector concentration, fund overlap, and wash-sale risk{" "}
          <span className="font-medium text-slate-900">
            across every account you own
          </span>{" "}
          — including the case where repurchasing in an IRA permanently
          disallows a loss, which a single-broker view has no way to see.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/demo"
            className="rounded bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Try it — no signup
          </Link>
          <Link
            href="/login"
            className="rounded border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Cross-account wash-sale detection
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Sell a loss in a taxable account, rebuy in an IRA within 30 days,
            and the loss is gone for good — not deferred, permanently
            disallowed (Rev. Rul. 2008-5). Your broker only sees one account;
            this checks all of them.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Concentration &amp; fund overlap
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Before you buy, see how it changes your sector allocation — and
            whether you already own the same exposure through an ETF you
            hold, like QQQ or VOO.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Portfolio health score
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            An A–F grade across diversification, concentration, risk, sector
            balance, tax efficiency, and cash allocation — recomputed daily.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        <h2 className="font-semibold">What this isn&apos;t</h2>
        <p className="mt-2">
          Ledger Check never places trades, never tells you to buy or sell a
          specific security, and isn&apos;t tax advice — every figure is
          labeled as an estimate, and every warning explains its own
          limitations. It&apos;s a second opinion, not an autopilot.
        </p>
      </section>

      <section className="mx-auto max-w-2xl text-center">
        <h2 className="text-lg font-semibold">Free while in beta</h2>
        <p className="mt-2 text-sm text-slate-600">
          Every feature above is free to use today. A Pro tier — deeper tax
          analysis, the AI second opinion, the investment journal, and
          proactive overlap alerts — is planned at $10–15/mo once the free
          tier has real users. No credit card, no trial clock.
        </p>
      </section>
    </div>
  );
}
