import { getDb } from "@/lib/db";
import { createLot, createSale, listLots } from "@/lib/queries";
import { previewFifoSell, type SimulatedTrade } from "@/lib/washSale";

export type RecordOutcome = { ok: true } | { ok: false; error: string };

/** Persist a simulated trade as real: buys add a lot; sells consume lots
 *  FIFO within the account and log a realized sale. */
export function recordTrade(
  trade: SimulatedTrade & { accountId: number },
  today: string
): RecordOutcome {
  const ticker = trade.ticker.toUpperCase();

  if (trade.side === "buy") {
    createLot({
      accountId: trade.accountId,
      ticker,
      shares: trade.shares,
      costPerShare: trade.pricePerShare,
      purchaseDate: today,
    });
    return { ok: true };
  }

  const lots = listLots();
  const preview = previewFifoSell(trade, lots);
  if (trade.shares > preview.sharesHeld) {
    return {
      ok: false,
      error: `You only hold ${preview.sharesHeld} shares of ${ticker} in that account.`,
    };
  }

  const accountLots = lots
    .filter((l) => l.ticker === ticker && l.accountId === trade.accountId)
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate));

  const db = getDb();
  db.exec("BEGIN");
  try {
    let toSell = trade.shares;
    for (const lot of accountLots) {
      if (toSell <= 0) break;
      const sold = Math.min(lot.shares, toSell);
      toSell -= sold;
      if (sold === lot.shares) {
        db.prepare("DELETE FROM lots WHERE id = ?").run(lot.id);
      } else {
        db.prepare("UPDATE lots SET shares = shares - ? WHERE id = ?").run(
          sold,
          lot.id
        );
      }
    }
    createSale({
      accountId: trade.accountId,
      ticker,
      shares: trade.shares,
      salePricePerShare: trade.pricePerShare,
      costPerShare: preview.avgCostPerShare,
      saleDate: today,
      source: "recorded",
    });
    db.exec("COMMIT");
    return { ok: true };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
