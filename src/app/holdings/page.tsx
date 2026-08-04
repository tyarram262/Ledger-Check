import { listAccounts, listJournalEntries, listLots, listSales } from "@/lib/queries";
import AccountForm from "@/components/AccountForm";
import AccountCashEditor from "@/components/AccountCashEditor";
import LotForm from "@/components/LotForm";
import SaleForm from "@/components/SaleForm";
import HoldingsTable from "@/components/HoldingsTable";
import SalesTable from "@/components/SalesTable";
import CsvImport from "@/components/CsvImport";
import BrokerageConnect from "@/components/BrokerageConnect";

export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  const accounts = await listAccounts();
  const lots = await listLots();
  const sales = await listSales();
  const journalEntries = await listJournalEntries();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Holdings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter what you own and any recent sales. The wash-sale check looks
          across every account here — including IRAs.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Accounts</h2>
        <p className="mt-1 text-sm text-slate-500">
          Cash balances feed the cash-allocation part of your portfolio
          health score — click a figure to edit it.
        </p>
        <AccountCashEditor accounts={accounts} />
        <div className="mt-4">
          <AccountForm />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Add a holding</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">
          One row per purchase lot — if you bought the same stock twice, enter
          it twice with each date and cost.
        </p>
        <LotForm accounts={accounts} />
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            …or import a CSV
          </h3>
          <CsvImport accounts={accounts} />
        </div>
        <BrokerageConnect />
        <div className="mt-6">
          <HoldingsTable lots={lots} entries={journalEntries} />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Past sales</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">
          Backfill sales from roughly the last 60 days. Sales at a loss are
          what the trade simulator checks against for wash-sale risk.
        </p>
        <SaleForm accounts={accounts} />
        <div className="mt-6">
          <SalesTable sales={sales} />
        </div>
      </section>
    </div>
  );
}
