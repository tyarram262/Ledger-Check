/**
 * Resolves an account-picker's stored selection against the *current*
 * account list. Every account `<select>` on `/holdings` (`LotForm.tsx`,
 * `CsvImport.tsx`, `SaleForm.tsx`, `TradeSimulator.tsx`) seeds its
 * `accountId` state with `accounts[0]?.id ?? 0` at mount. `router.refresh()`
 * — how this app re-fetches server data after a write (see CLAUDE.md /
 * AGENTS.md conventions) — is a *soft* refresh: it re-renders these client
 * components with fresh `accounts` props but does not remount them, so
 * their `useState` survives untouched. A picker that mounted with zero
 * accounts stays stuck at `0` even after the first account is created,
 * which fails the very next submit with "Unknown account." (the account
 * existence check in e.g. `api/lots/route.ts`). Deriving the *effective*
 * id through this function on every render, rather than trusting the raw
 * state, closes that gap without needing a `useEffect` resync in four
 * separate components.
 */
export function resolveAccountId(accounts: { id: number }[], selected: number): number {
  return accounts.some((a) => a.id === selected) ? selected : (accounts[0]?.id ?? 0);
}
