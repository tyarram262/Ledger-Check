import type { MetadataRoute } from "next";

const SITE_URL = "https://ledger-check-henna.vercel.app";

/** Only the public marketing surface (see `PUBLIC_PATHS` in
 *  `src/lib/supabase/proxy.ts`) should be crawlable — everything else
 *  requires a session and holds a specific user's financial data. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/demo", "/privacy", "/terms"],
      disallow: ["/holdings", "/simulate", "/settings", "/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
