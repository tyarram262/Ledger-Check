import { NextResponse } from "next/server";
import { createAccount, createLot, createSale, deleteSampleAccounts, listAccounts } from "@/lib/queries";
import { sampleSeedPlan } from "@/lib/samplePortfolio";

/**
 * Backs the "Load a sample portfolio" / "Remove sample data" controls on
 * the `/holdings` and `/` zero-states (see CLAUDE.md's Phase 4 slice 2 —
 * fixing the first-run trap). Seeds real, `is_sample`-flagged rows from
 * `sampleSeedPlan()` (itself derived from the `/demo` fixture) so a
 * brand-new signup can reach a real health score and wash-sale warning
 * within one click, without touching a real user's data.
 */

export async function POST() {
  // Only offered on an empty portfolio — this isn't a general "add fixture
  // data" tool, just the specific first-run unblock. A user who already has
  // real accounts should use manual entry / CSV / brokerage sync instead.
  if ((await listAccounts()).length > 0) {
    return NextResponse.json(
      { error: "Sample data can only be loaded into an empty portfolio." },
      { status: 409 }
    );
  }

  const plan = sampleSeedPlan();

  // No client-side transaction API (supabase-js) — same constraint noted on
  // `record_sell` in CLAUDE.md. A failure partway through leaves some
  // `is_sample` rows behind, which "Remove sample data" (DELETE below)
  // cleans up in one shot, so this stays recoverable without a Postgres
  // function for what's a low-stakes, easily-undone seed.
  try {
    for (const accountPlan of plan.accounts) {
      const account = await createAccount(accountPlan.name, accountPlan.type, {
        isSample: true,
        cashBalance: accountPlan.cashBalance,
      });

      const lots = plan.lotsByFixtureAccountId.get(accountPlan.fixtureAccountId) ?? [];
      for (const lot of lots) {
        await createLot({
          accountId: account.id,
          ticker: lot.ticker,
          shares: lot.shares,
          costPerShare: lot.costPerShare,
          purchaseDate: lot.purchaseDate,
          source: "manual",
        });
      }

      const sales = plan.sales.filter((s) => s.fixtureAccountId === accountPlan.fixtureAccountId);
      for (const sale of sales) {
        await createSale({
          accountId: account.id,
          ticker: sale.ticker,
          shares: sale.shares,
          salePricePerShare: sale.salePricePerShare,
          costPerShare: sale.costPerShare,
          saleDate: sale.saleDate,
          source: "manual",
        });
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load the sample portfolio." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE() {
  const removed = await deleteSampleAccounts();
  if (removed === 0) {
    return NextResponse.json({ error: "No sample data to remove." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
