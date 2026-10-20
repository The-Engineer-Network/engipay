import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/site"

/** Marketing pages only; signed-in app routes are deliberately left out. */
const MARKETING_PATHS = ["", "/features", "/technology", "/about", "/faq", "/help", "/privacy"]

export default function sitemap(): MetadataRoute.Sitemap {
  return MARKETING_PATHS.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.6,
  }))
}
