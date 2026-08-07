import type { MetadataRoute } from "next";

const SITE_URL = "https://ledger-check-henna.vercel.app";

/** Public marketing pages only — deliberately excludes every auth-gated
 *  route (`/holdings`, `/simulate`, `/settings`, etc.), which hold a
 *  specific user's financial data and shouldn't be indexed. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/demo`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/login`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.1 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.1 },
  ];
}
