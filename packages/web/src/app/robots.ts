import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/catalog-seo";

export const dynamic = "force-dynamic";

/** robots.txt: todo indexable salvo la API, el MCP y las páginas de desarrollo. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/mcp/", "/*/dev/"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
