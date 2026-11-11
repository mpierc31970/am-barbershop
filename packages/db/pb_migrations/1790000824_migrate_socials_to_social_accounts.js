/// <reference path="../pb_data/types.d.ts" />
// P11 (11-03; DASH-14): one social source. Every business_profile.socials entry is copied
// into social_accounts in array order (order = index). Preset platforms keep their key and
// a fixed short code; "other" (and any unknown key) becomes platform "custom", label
// "Other", short code go-<n> unique per org. A preset used twice also falls back to go-<n>,
// so (organization, short_code) never collides. Entries without an http(s) URL are skipped
// and only their count is logged (no URLs or org ids in logs). An org that already has
// social_accounts rows is left alone (re-run safe). The socials field itself is dropped in
// 11-35 after every reader has switched.
// Down deletes the social_accounts rows of every org whose profile still has socials.
const PRESET_CODES = {
  facebook: "fb",
  instagram: "ig",
  tiktok: "tt",
  youtube: "yt",
  linkedin: "li",
  pinterest: "pin",
  x: "x",
  threads: "th",
  yelp: "yelp",
  nextdoor: "nd",
};
const URL_OK = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

function socialsOf(profile) {
  let raw;
  try {
    raw = JSON.parse(profile.getString("socials") || "null");
  } catch (_) {
    return [];
  }
  return Array.isArray(raw) ? raw : [];
}

function profilesWithSocials(app) {
  return app
    .findRecordsByFilter("business_profile", "organization != ''", "", 0, 0)
    .filter((p) => socialsOf(p).length > 0);
}

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("social_accounts");
    let skipped = 0;
    let created = 0;
    for (const profile of profilesWithSocials(app)) {
      const org = profile.getString("organization");
      const existing = app.findRecordsByFilter(
        "social_accounts",
        "organization = {:org}",
        "",
        1,
        0,
        { org: org },
      );
      if (existing.length > 0) continue;
      const used = {};
      let n = 0;
      let order = 0;
      for (const entry of socialsOf(profile)) {
        const url =
          entry && typeof entry.url === "string" ? entry.url.trim() : "";
        if (!URL_OK.test(url) || url.length > 500) {
          skipped++;
          continue;
        }
        const key =
          entry && typeof entry.platform === "string" ? entry.platform : "";
        const preset = Object.prototype.hasOwnProperty.call(PRESET_CODES, key);
        let code = preset ? PRESET_CODES[key] : "";
        if (!code || used[code]) {
          do {
            n++;
            code = "go-" + n;
          } while (used[code]);
        }
        used[code] = true;
        const record = new Record(col);
        record.set("organization", org);
        record.set("platform", preset ? key : "custom");
        record.set("label", preset ? "" : "Other");
        record.set("url", url);
        record.set("short_code", code);
        record.set("order", order);
        app.save(record);
        order++;
        created++;
      }
    }
    if (created > 0 || skipped > 0) {
      console.log(
        "[socials->social_accounts] created " +
          created +
          ", skipped invalid " +
          skipped,
      );
    }
  },
  (app) => {
    for (const profile of profilesWithSocials(app)) {
      const rows = app.findRecordsByFilter(
        "social_accounts",
        "organization = {:org}",
        "",
        0,
        0,
        { org: profile.getString("organization") },
      );
      for (const row of rows) app.delete(row);
    }
  },
);
