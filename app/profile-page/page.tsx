import { redirect } from "next/navigation"

/**
 * `/profile-page` was an unreachable duplicate of `/defi` — same components,
 * same tabs, linked from nowhere. Kept as a redirect so existing bookmarks
 * still resolve.
 */
export default function ProfilePageRedirect() {
  redirect("/defi")
}
