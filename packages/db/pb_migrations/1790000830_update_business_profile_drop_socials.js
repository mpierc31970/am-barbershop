/// <reference path="../pb_data/types.d.ts" />
// P11 (11-35; DASH-14, RESEARCH Pitfall 3): social_accounts is the one source of social links.
// Every reader (site context, footer, Social block, JSON-LD sameAs, snapshot) and writer
// (intake contact step, dev seeds) moved in 11-35, and 1790000824 copied the old values, so
// business_profile.socials is dropped.
// Down re-adds the json field and copies each org's accounts back into it in order (presets
// keep their key, custom accounts become "other"), so 824's down still finds the profiles
// whose rows it removes.
const PRESETS = [
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
  "pinterest",
  "x",
  "threads",
  "yelp",
  "nextdoor",
];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("business_profile");
    if (col.fields.getByName("socials")) {
      col.fields.removeByName("socials");
      app.save(col);
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId("business_profile");
    if (!col.fields.getByName("socials")) {
      col.fields.add(new JSONField({ name: "socials", maxSize: 4000 }));
      app.save(col);
    }
    let restored = 0;
    const profiles = app.findRecordsByFilter(
      "business_profile",
      "organization != ''",
      "",
      0,
      0,
    );
    for (const profile of profiles) {
      const rows = app.findRecordsByFilter(
        "social_accounts",
        "organization = {:org}",
        "order,created",
        0,
        0,
        { org: profile.getString("organization") },
      );
      if (rows.length === 0) continue;
      const links = rows.map((r) => {
        const platform = r.getString("platform");
        return {
          platform: PRESETS.indexOf(platform) >= 0 ? platform : "other",
          url: r.getString("url"),
        };
      });
      profile.set("socials", links);
      app.save(profile);
      restored++;
    }
    if (restored > 0) {
      console.log("[drop socials down] restored " + restored + " profiles");
    }
  },
);
