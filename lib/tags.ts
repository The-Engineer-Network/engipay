/** Tags a user may never claim. Mirrors RESERVED_TAGS in backend routes/me.rs. */
const RESERVED_TAGS = ["admin", "engipay", "support", "system", "help"]

export type TagCheck = { ok: true; tag: string } | { ok: false; reason: string }

/**
 * Checks a tag the user is typing, before it is sent. A leading @ and outer
 * spaces are removed. The rules match the API's, so most mistakes are caught
 * here; the API still decides whether a tag is free.
 */
export function checkTag(input: string): TagCheck {
  const tag = input.trim().replace(/^@/, "")
  if (!/^[A-Za-z0-9_]{3,20}$/.test(tag)) {
    return { ok: false, reason: "Use 3 to 20 letters, numbers or underscores." }
  }
  if (RESERVED_TAGS.includes(tag.toLowerCase())) {
    return { ok: false, reason: `"${tag}" is reserved and cannot be used.` }
  }
  return { ok: true, tag }
}
