// Contacts CSV column mapping and specs (CONTACTS-01, D120, D-UI-P7-22): pure unit tests.
import { InvalidInput } from "@cds/core";
import { ERR_EMAIL } from "@cds/core/email";
import { exportCsv, validateRows } from "@cds/core/csv";
import { describe, expect, it } from "vitest";
import {
  CONTACTS_EXPORT_CSV,
  CONTACTS_IMPORT_CSV,
  MATCH_EMAIL_COPY,
  needsMatch,
  remapToCanonical,
  suggestContactColumns,
} from "./csv-map";

describe("suggestContactColumns", () => {
  it("maps common headers by alias", () => {
    expect(
      suggestContactColumns([
        "E-mail",
        "First Name",
        "Last Name",
        "Mobile",
        "Labels",
        "Notes",
      ]),
    ).toEqual(["email", "first_name", "last_name", "phone", "tags", "skip"]);
  });

  it("is case- and space-insensitive and knows the documented aliases", () => {
    expect(
      suggestContactColumns([
        "EMAIL ADDRESS",
        "full name",
        "Phone number",
        "Tag",
      ]),
    ).toEqual(["email", "name", "phone", "tags"]);
    expect(suggestContactColumns(["Email", "Name", "Phone", "Tags"])).toEqual([
      "email",
      "name",
      "phone",
      "tags",
    ]);
  });

  it("gives a target to the first matching column only", () => {
    expect(suggestContactColumns(["Email", "E-mail"])).toEqual([
      "email",
      "skip",
    ]);
  });

  it("skips the export-only columns", () => {
    expect(
      suggestContactColumns([
        "id",
        "Name",
        "Email",
        "Phone",
        "Tags",
        "Newsletter",
        "Source",
        "Last activity",
        "Added",
      ]),
    ).toEqual([
      "skip",
      "name",
      "email",
      "phone",
      "tags",
      "skip",
      "skip",
      "skip",
      "skip",
    ]);
  });
});

describe("needsMatch", () => {
  it("is false for exact labels and for the export's own header", () => {
    expect(needsMatch(["Name", "Email", "Phone", "Tags"])).toBe(false);
    expect(needsMatch([" email ", "NAME"])).toBe(false);
    expect(
      needsMatch([
        "id",
        "Name",
        "Email",
        "Phone",
        "Tags",
        "Newsletter",
        "Source",
        "Last activity",
        "Added",
      ]),
    ).toBe(false);
  });

  it("is true when any header is a guess or there is no email", () => {
    expect(needsMatch(["E-mail", "Name"])).toBe(true);
    expect(needsMatch(["Name", "Phone"])).toBe(true);
    expect(needsMatch(["Email", "Notes"])).toBe(true);
  });
});

describe("remapToCanonical", () => {
  it("joins First + Last into Name and drops skipped columns", () => {
    const out = remapToCanonical(
      {
        header: ["E-mail", "First Name", "Last Name", "Notes"],
        rows: [
          ["m@x.co", " Maria ", "Lopez", "secret"],
          ["s@x.co", "Sam", "", "x"],
        ],
      },
      ["email", "first_name", "last_name", "skip"],
    );
    expect(out).toEqual({
      ok: true,
      header: ["Name", "Email", "Phone", "Tags"],
      rows: [
        ["Maria Lopez", "m@x.co", "", ""],
        ["Sam", "s@x.co", "", ""],
      ],
    });
  });

  it("keeps a mapped Name over First + Last", () => {
    const out = remapToCanonical(
      { header: ["Name", "First", "Email"], rows: [["Full", "F", "a@b.co"]] },
      ["name", "first_name", "email"],
    );
    expect(out.ok && out.rows[0]![0]).toBe("Full");
  });

  it("drops export-only columns even when mapped", () => {
    const out = remapToCanonical(
      {
        header: ["id", "Email", "Newsletter"],
        rows: [["abc", "a@b.co", "Subscribed"]],
      },
      ["tags", "email", "tags"],
    );
    expect(out).toEqual({
      ok: true,
      header: ["Name", "Email", "Phone", "Tags"],
      rows: [["", "a@b.co", "", ""]],
    });
  });

  it("returns MATCH-EMAIL when no column goes to Email", () => {
    expect(
      remapToCanonical({ header: ["Name"], rows: [["x"]] }, ["name"]),
    ).toEqual({
      ok: false,
      message: MATCH_EMAIL_COPY,
    });
    expect(MATCH_EMAIL_COPY).toBe(
      "Match a column to Email. Every contact needs one.",
    );
  });

  it("refuses a mapping of the wrong length or with unknown targets", () => {
    const parsed = { header: ["Email", "Name"], rows: [] };
    expect(() => remapToCanonical(parsed, ["email"])).toThrow(InvalidInput);
    expect(() =>
      remapToCanonical(parsed, ["email", "organization"] as never),
    ).toThrow(InvalidInput);
    expect(() => remapToCanonical(parsed, "email" as never)).toThrow(
      InvalidInput,
    );
  });
});

describe("CONTACTS_IMPORT_CSV", () => {
  const col = (k: string) =>
    CONTACTS_IMPORT_CSV.columns.find((c) => c.key === k)!;

  it("has name, email (required), phone, tags and the email natural key", () => {
    expect(CONTACTS_IMPORT_CSV.columns.map((c) => c.key)).toEqual([
      "name",
      "email",
      "phone",
      "tags",
    ]);
    expect(col("email").required).toBe(true);
    expect(CONTACTS_IMPORT_CSV.naturalKey).toEqual(["email"]);
    expect(CONTACTS_IMPORT_CSV.singular).toBe("contact");
    expect(CONTACTS_IMPORT_CSV.plural).toBe("contacts");
    expect(
      CONTACTS_IMPORT_CSV.columns.some((c) =>
        /consent|newsletter/i.test(c.key),
      ),
    ).toBe(false);
  });

  it("normalises the email, refuses a bad one with owner copy", () => {
    expect(col("email").parse(" Maria@Example.COM ")).toEqual({
      ok: true,
      value: "maria@example.com",
    });
    const bad = col("email").parse("maria@");
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect([
        ERR_EMAIL,
        '"maria@" isn\'t a complete email address.',
      ]).toContain(bad.message);
  });

  it("parses tags and refuses a non-phone", () => {
    expect(col("tags").parse("VIP; News")).toEqual({
      ok: true,
      value: ["VIP", "News"],
    });
    expect(col("tags").format(["VIP", "News"])).toBe("VIP; News");
    expect(col("phone").parse("call me").ok).toBe(false);
    expect(col("phone").parse("+1 (512) 555-0142")).toEqual({
      ok: true,
      value: "+1 (512) 555-0142",
    });
    expect(col("phone").parse("")).toEqual({ ok: true, value: "" });
  });

  it("validates rows with the engine", () => {
    const res = validateRows(
      {
        header: ["Name", "Email", "Phone", "Tags"],
        rows: [
          ["M", "m@x.co", "", "VIP"],
          ["N", "", "", ""],
        ],
      },
      CONTACTS_IMPORT_CSV,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows[0]!.values).toEqual({
        name: "M",
        email: "m@x.co",
        phone: "",
        tags: ["VIP"],
      });
      expect(res.rows[1]!.errors).toHaveLength(1);
    }
  });
});

describe("CONTACTS_EXPORT_CSV", () => {
  it("has the export header and owner words", () => {
    const csv = exportCsv(CONTACTS_EXPORT_CSV, [
      {
        id: "c1",
        name: "Maria",
        email: "m@x.co",
        phone: "",
        tags: ["VIP", "News"],
        newsletter: "confirmed",
        source: "manual",
        last_seen_at: "2026-10-05 10:00:00.000Z",
        created: "2026-09-01 08:00:00.000Z",
      },
      {
        id: "c2",
        name: "",
        email: "n@x.co",
        tags: [],
        newsletter: "none",
        source: "subscribe",
      },
    ]);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe(
      "id,Name,Email,Phone,Tags,Newsletter,Source,Last activity,Added",
    );
    expect(lines[1]).toBe(
      "c1,Maria,m@x.co,,VIP; News,Subscribed,Added by you,2026-10-05,2026-09-01",
    );
    expect(lines[2]).toBe("c2,,n@x.co,,,,Newsletter,,");
  });

  it("labels every status and source", () => {
    const nl = CONTACTS_EXPORT_CSV.columns.find((c) => c.key === "newsletter")!;
    expect(
      ["confirmed", "unconfirmed", "withdrawn", "none"].map((s) =>
        nl.format(s),
      ),
    ).toEqual(["Subscribed", "Not confirmed", "Unsubscribed", ""]);
    const src = CONTACTS_EXPORT_CSV.columns.find((c) => c.key === "source")!;
    expect(
      [
        "form",
        "booking",
        "subscribe",
        "registration",
        "purchase",
        "import",
        "manual",
      ].map((s) => src.format(s)),
    ).toEqual([
      "Form",
      "Booking",
      "Newsletter",
      "Registration",
      "Purchase",
      "Import",
      "Added by you",
    ]);
  });
});
