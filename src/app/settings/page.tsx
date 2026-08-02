import { getSettings } from "@/lib/queries";
import SettingsForm from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Disclaimer &amp; settings
        </h1>
      </div>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <h2 className="text-base font-semibold">Informational tool only</h2>
        <p className="mt-2">
          Ledger Check is an informational gut-check, not tax or investment
          advice. It does not know your full tax situation (basis elections,
          prior-year carryovers, spousal accounts, wash sales from before you
          started using it, etc.) and cannot replace a tax professional or
          your broker&apos;s official records. Always confirm wash-sale and
          cost-basis outcomes with a qualified preparer before filing.
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Known limitations</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>
            &ldquo;Substantially identical&rdquo; means the{" "}
            <strong>same ticker only</strong>. Different funds that track the
            same index (e.g. VOO vs. SPY) are economically similar but are
            not detected as a wash sale here — that requires a fund-overlap
            mapping this MVP doesn&apos;t have yet.
          </li>
          <li>
            The wash-sale check is <strong>binary</strong>: any matching buy
            or sell within the 61-day window flags the whole trade. The IRS
            rule actually disallows the loss proportionally to the number of
            replacement shares — this tool doesn&apos;t compute that split.
          </li>
          <li>
            Spousal accounts and non-US tax rules aren&apos;t supported.
          </li>
          <li>
            Sector mapping is a static local table. ETFs are mapped to a
            single &ldquo;primary tilt&rdquo; sector for concentration
            purposes, and tickers outside the table show up as
            &ldquo;Unmapped.&rdquo;
          </li>
          <li>
            <strong>Fund overlap</strong> (Trade Check) uses a static,
            hand-curated snapshot of each fund&apos;s top ~10-25 holdings —
            not live data, and not the fund&apos;s full holdings list. It&apos;s
            an approximation, dated on each fund&apos;s entry.
          </li>
          <li>
            <strong>Estimated tax</strong> (Tax Check) is a marginal-rate
            approximation: current-year federal brackets plus your flat state
            rate. It does not model AMT, other income sources, itemized
            deductions, or state-specific rules beyond a single flat rate.
          </li>
          <li>
            <strong>Tax efficiency</strong> (Portfolio Health Score) is
            computed only from <em>unrealized</em> positions &mdash; the sales
            you&apos;ve recorded don&apos;t store an acquisition date, so
            realized short/long-term gains can&apos;t be reconstructed.
          </li>
          <li>
            The Portfolio Health Score is a deterministic, rules-based
            summary of your current holdings &mdash; not a prediction, not
            investment advice, and not personalized beyond the tax profile
            you set here.
          </li>
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Concentration &amp; tax profile</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">
          The dashboard and trade check flag a sector as &ldquo;elevated&rdquo;
          once it crosses the threshold below (and &ldquo;high&rdquo; well
          above that). Your tax profile drives the estimated tax shown on the
          sell side of the trade check.
        </p>
        <SettingsForm initialSettings={settings} />
      </section>
    </div>
  );
}
