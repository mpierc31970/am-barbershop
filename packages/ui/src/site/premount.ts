// Pre-mount layout hints for site islands (10-44 CLS; review CR-C02, WR-C02).
//
// An island whose mounted layout differs from its no-JS markup (a multi-step Pro form, a
// Pro table with search or paging) marks its root `data-premount` on the server. Classes
// under `[@media(scripting:enabled)]:group-data-[premount]/<name>:` lay the markup out as the
// island will, so mounting moves nothing. The island drops the attribute when it mounts; the
// inline fallback below (rendered right after the root) drops it after 5 s if the island
// never mounts (chunk error, blocked script), so the full no-JS markup comes back and nothing
// stays hidden. Without scripting the hints never apply.

/** How long an island root waits for its island before the no-JS layout returns. */
export const PREMOUNT_FALLBACK_MS = 5000;

/**
 * Drops `data-premount` from the element just before this script after PREMOUNT_FALLBACK_MS,
 * unless the island already did. Never throws; touches nothing else.
 */
export const PREMOUNT_FALLBACK_SCRIPT = `(function(s){var f=s&&s.previousElementSibling;setTimeout(function(){if(f&&f.hasAttribute("data-premount"))f.removeAttribute("data-premount")},${PREMOUNT_FALLBACK_MS})})(document.currentScript)`;
