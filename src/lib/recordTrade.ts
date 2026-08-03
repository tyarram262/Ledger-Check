import { createClient } from "@/lib/supabase/server";
import { createLot } from "@/lib/queries";
import type { SimulatedTrade } from "@/lib/washSale";

export type RecordOutcome =
  | { ok: true; lotId?: number } // lotId present for buys only
  | { ok: false; error: string };

/** Persist a simulated trade as real: buys add a lot; sells consume lots
 *  FIFO within the account (atomically, via the record_sell DB function)
 *  and log a realized sale. */
export async function recordTrade(
  trade: SimulatedTrade & { accountId: number },
  today: string
): Promise<RecordOutcome> {
  const ticker = trade.ticker.toUpperCase();

  if (trade.side === "buy") {
    const lotId = await createLot({
      accountId: trade.accountId,
      ticker,
      shares: trade.shares,
      costPerShare: trade.pricePerShare,
      purchaseDate: today,
    });
    return { ok: true, lotId };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_sell", {
    p_account_id: trade.accountId,
    p_ticker: ticker,
    p_shares: trade.shares,
    p_sale_price: trade.pricePerShare,
    p_sale_date: today,
  });
  if (error) {
    if (error.message.includes("Not enough shares held")) {
      return { ok: false, error: `You don't hold enough ${ticker} in that account.` };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
