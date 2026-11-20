/** Public origin used for absolute URLs in metadata, robots and the sitemap. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://engipay.vercel.app").replace(/\/$/, "")
