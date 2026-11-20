import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/site"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Signed-in app routes hold wallet state and have nothing to index.
      disallow: [
        "/dashboard",
        "/send",
        "/receive",
        "/scan",
        "/convert",
        "/buy",
        "/sell",
        "/activity",
        "/settings",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
