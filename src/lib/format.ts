const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatUsd(value: number): string {
  return usd.format(value);
}

export function formatShares(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}
