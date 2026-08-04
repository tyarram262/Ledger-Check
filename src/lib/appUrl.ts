import { type NextRequest } from "next/server";

const fallbackProdUrl = "https://ledger-check-henna.vercel.app";

export function getAppUrl(request?: NextRequest) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/\/$/, "")}`;
  }

  const requestOrigin = request?.nextUrl.origin;
  if (requestOrigin && !requestOrigin.includes("localhost")) {
    return requestOrigin.replace(/\/$/, "");
  }

  return fallbackProdUrl;
}