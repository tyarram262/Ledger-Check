import { getConcentrationThreshold } from "@/lib/queries";
import SettingsForm from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const threshold = await getConcentrationThreshold();

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
            single &ldquo;primary tilt&rdquo; sector, not a true
            holding-level look-through, and tickers outside the table show up
            as &ldquo;Unmapped.&rdquo;
          </li>
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">
          Sector concentration threshold
        </h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">
          The dashboard and trade simulator flag a sector as
          &ldquo;elevated&rdquo; once it crosses this percentage of your
          portfolio (and &ldquo;high&rdquo; well above that). Default is 25%.
        </p>
        <SettingsForm initialThreshold={threshold} />
      </section>
    </div>
  );
}
