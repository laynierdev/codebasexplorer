import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Private, user-specific views (projects, settings, search) are kept out of search results with a `noindex` meta tag
 * rather than a robots.txt rule: crawlers can only honor `noindex` if they are allowed to fetch the page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
