// Services and Our team renderers (08-05; TMPL-01, TMPL-02, D253, D-UI-P8-13..19). Rendered
// directly (not through the registry); coreData is passed in as 08-08's loader will build it.
import {
  defaultServicesBlock,
  defaultTeamBlock,
  type ServicesBlockContent,
  type TeamBlockContent,
} from "@cds/core/content";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CoreBoundData, ResolvedMedia } from "../types";
import { ServicesSection } from "./ServicesSection";
import { TeamSection } from "./TeamSection";
import {
  durationText,
  initialsOf,
  priceText,
  readServices,
  readTeam,
} from "./services-team";

const base = {
  layout: "full" as const,
  background: "main" as const,
  isH1Owner: false,
  isFirst: false,
  now: new Date("2026-10-07T15:00:00.000Z"),
};

type Svc = NonNullable<CoreBoundData["services"]>[number];
type Member = NonNullable<CoreBoundData["team"]>[number];

const svc = (i: number, over: Partial<Svc> = {}): Svc => ({
  id: `s${i}`,
  name: `Service ${i}`,
  description: `About service ${i}`,
  price_type: "fixed",
  price_cents: 4500,
  duration_minutes: 45,
  ...over,
});

const photo = (id: string, alt = ""): ResolvedMedia => ({
  id,
  kind: "image",
  src: `https://cdn.example/${id}.webp`,
  srcSet: `https://cdn.example/${id}-480.webp 480w`,
  width: 480,
  height: 480,
  alt,
});

const member = (i: number, over: Partial<Member> = {}): Member => ({
  id: `m${i}`,
  name: `Member Number${i}`,
  role: `Role ${i}`,
  bio: `Line one ${i}\nLine two ${i}`,
  photo: photo(`p${i}`, `Photo of member ${i}`),
  ...over,
});

const data = (over: Partial<CoreBoundData> = {}): CoreBoundData => ({
  media: {},
  ...over,
});

const services = (
  c: Partial<ServicesBlockContent>,
  coreData?: CoreBoundData,
  background: "main" | "alternate" = "main",
) =>
  renderToStaticMarkup(
    <ServicesSection
      {...base}
      background={background}
      content={{ ...defaultServicesBlock(), ...c }}
      coreData={coreData}
    />,
  );

const team = (
  c: Partial<TeamBlockContent>,
  coreData?: CoreBoundData,
  background: "main" | "alternate" = "main",
) =>
  renderToStaticMarkup(
    <TeamSection
      {...base}
      background={background}
      content={{ ...defaultTeamBlock(), ...c }}
      coreData={coreData}
    />,
  );

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

function clean(html: string) {
  expect(html).not.toMatch(/undefined|null|NaN/);
  expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
}

describe("pure helpers", () => {
  it("formats prices", () => {
    expect(priceText("fixed", 4500)).toBe("$45");
    expect(priceText("fixed", 4550)).toBe("$45.50");
    expect(priceText("fixed", 123456)).toBe("$1,234.56");
    expect(priceText("from", 4500)).toBe("From $45");
    expect(priceText("free", null)).toBe("Free");
    expect(priceText("ask", null)).toBe("Ask for a price");
    expect(priceText("fixed", null)).toBe("");
    expect(priceText("from", -5)).toBe("");
  });

  it("formats durations in words", () => {
    expect(durationText(45)).toBe("45 minutes");
    expect(durationText(1)).toBe("1 minute");
    expect(durationText(60)).toBe("1 hour");
    expect(durationText(120)).toBe("2 hours");
    expect(durationText(90)).toBe("90 minutes");
    expect(durationText(null)).toBe("");
    expect(durationText(0)).toBe("");
  });

  it("takes initials from the first and last word", () => {
    expect(initialsOf("Jo Rivera")).toBe("JR");
    expect(initialsOf("maría de la cruz")).toBe("MC");
    expect(initialsOf("Cher")).toBe("C");
    expect(initialsOf("  ")).toBe("");
  });

  it("reads coreData defensively", () => {
    expect(readServices(undefined)).toEqual([]);
    expect(
      readServices({
        media: {},
        services: [
          svc(1),
          { bad: true },
          svc(2, { name: "  " }),
          svc(3, { price_type: "weird" as never }),
        ] as never,
      }).map((s) => s.id),
    ).toEqual(["s1", "s3"]);
    expect(
      readServices({
        media: {},
        services: [svc(3, { price_type: "weird" as never })],
      })[0]?.price_type,
    ).toBe("ask");
    expect(readTeam({ media: {}, team: "nope" as never })).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => member(i));
    expect(readTeam({ media: {}, team: many })).toHaveLength(24);
  });
});

describe("ServicesSection", () => {
  it("renders cards with the exactly-4 two-column rule", () => {
    const html = services(
      { display: "cards" },
      data({ services: [1, 2, 3, 4].map((i) => svc(i)) }),
    );
    expect(count(html, /<li/g)).toBe(4);
    expect(html).toContain("sm:grid-cols-2");
    expect(html).not.toContain("lg:grid-cols-3");
    expect(html).toContain("<h2");
    expect(count(html, /<h3/g)).toBe(4);
    expect(html).toContain("bg-site-surface-raised");
    clean(html);
    const five = services(
      { display: "cards" },
      data({ services: [1, 2, 3, 4, 5].map((i) => svc(i)) }),
    );
    expect(five).toContain("lg:grid-cols-3");
  });

  it("uses the surface ground for cards on an alternate band", () => {
    const html = services(
      { display: "cards" },
      data({ services: [svc(1)] }),
      "alternate",
    );
    expect(html).toMatch(/<li[^>]*bg-site-surface[ "]/);
    expect(html).not.toMatch(/<li[^>]*bg-site-surface-raised/);
  });

  it("cuts to the chosen count; 0 shows all", () => {
    const twelve = data({
      services: Array.from({ length: 12 }, (_, i) => svc(i)),
    });
    expect(count(services({ limit: 6 }, twelve), /<li/g)).toBe(6);
    expect(count(services({ limit: 0 }, twelve), /<li/g)).toBe(12);
  });

  it("prints price and duration words with tabular numbers", () => {
    const html = services(
      { display: "list" },
      data({
        services: [
          svc(1, { price_cents: 4550, duration_minutes: 60 }),
          svc(2, { price_type: "from", duration_minutes: 120 }),
          svc(3, {
            price_type: "free",
            price_cents: null,
            duration_minutes: 90,
          }),
          svc(4, {
            price_type: "ask",
            price_cents: null,
            duration_minutes: null,
          }),
        ],
      }),
    );
    expect(html).toContain("$45.50");
    expect(html).toContain("From $45");
    expect(html).toContain("Free");
    expect(html).toContain("Ask for a price");
    expect(html).toContain("1 hour");
    expect(html).toContain("2 hours");
    expect(html).toContain("90 minutes");
    expect(html).toContain("tabular-nums");
    expect(html).toContain("max-w-[768px]");
    expect(count(html, /<h3/g)).toBe(4);
    clean(html);
  });

  it("hides durations and descriptions on request", () => {
    const d = data({ services: [svc(1)] });
    expect(services({ show_durations: false }, d)).not.toContain("45 minutes");
    expect(services({ show_descriptions: false }, d)).not.toContain(
      "About service 1",
    );
    expect(services({}, d)).toContain("About service 1");
  });

  it("keeps a visually hidden h2 when the heading is blank (WR-C03)", () => {
    const html = services({ heading: "  " }, data({ services: [svc(1)] }));
    expect(count(html, /<h2/g)).toBe(1);
    expect(html).toContain('<h2 class="sr-only">Services</h2>');
    expect(html).toContain("<h3");
  });

  it("renders nothing without services; the editor preview shows the empty card", () => {
    expect(services({}, undefined)).toBe("");
    expect(services({}, data({ services: [] }))).toBe("");
    const preview = services({}, data({ services: [], editorPreview: true }));
    expect(preview).toContain("No services showing yet");
    expect(preview).toContain(
      "Add services in Website › Services and they show here.",
    );
  });
});

describe("TeamSection", () => {
  it("renders one member as a profile with the photo description as alt", () => {
    const html = team({}, data({ team: [member(1)] }));
    expect(html).toContain("md:flex-row");
    expect(html).toContain('alt="Photo of member 1"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("whitespace-pre-line");
    expect(html).toContain("<h3");
    clean(html);
  });

  it("uses an empty alt when the photo has no description", () => {
    const html = team({}, data({ team: [member(1, { photo: photo("p1") })] }));
    expect(html).toContain('alt=""');
  });

  it("gives a missing photo an initials tile in a mixed team", () => {
    const html = team(
      {},
      data({
        team: [
          member(1),
          member(2, { name: "Jo Rivera", photo: undefined }),
          member(3),
        ],
      }),
    );
    expect(count(html, /<li/g)).toBe(3);
    expect(count(html, /<img/g)).toBe(2);
    expect(html).toMatch(/aria-hidden="true"[^>]*>JR</);
    expect(html).toContain("aspect-square");
    expect(html).toContain("lg:grid-cols-3");
    clean(html);
  });

  it("uses 64px initials circles when no member has a photo", () => {
    const html = team(
      {},
      data({
        team: [1, 2, 3].map((i) => member(i, { photo: undefined })),
      }),
    );
    expect(count(html, /<img/g)).toBe(0);
    expect(count(html, /size-16 /g)).toBe(3);
    expect(html).not.toContain("aspect-square");
  });

  it("picks 2 columns for two members and 4 for 4/7/8", () => {
    expect(team({}, data({ team: [member(1), member(2)] }))).toContain(
      "sm:grid-cols-2",
    );
    const four = team({}, data({ team: [1, 2, 3, 4].map((i) => member(i)) }));
    expect(four).toContain("lg:grid-cols-4");
    const seven = team(
      {},
      data({ team: [1, 2, 3, 4, 5, 6, 7].map((i) => member(i)) }),
    );
    expect(seven).toContain("lg:grid-cols-4");
    const nine = team(
      {},
      data({ team: Array.from({ length: 9 }, (_, i) => member(i)) }),
    );
    expect(nine).toContain("lg:grid-cols-3");
  });

  it("keeps a visually hidden h2 when the heading is blank (WR-C03)", () => {
    const html = team({ heading: "" }, data({ team: [member(1)] }));
    expect(count(html, /<h2/g)).toBe(1);
    expect(html).toContain('<h2 class="sr-only">Our team</h2>');
    const named = team({ heading: "Meet us" }, data({ team: [member(1)] }));
    expect(named).not.toContain("sr-only");
  });

  it("hides roles and bios on request", () => {
    const d = data({ team: [member(1), member(2)] });
    expect(team({ show_roles: false }, d)).not.toContain("Role 1");
    expect(team({ show_bios: false }, d)).not.toContain("Line one 1");
    expect(team({}, d)).toContain("Role 1");
  });

  it("renders nothing without members; the editor preview shows the empty card", () => {
    expect(team({}, undefined)).toBe("");
    expect(team({}, data({ team: [] }))).toBe("");
    const preview = team({}, data({ team: [], editorPreview: true }));
    expect(preview).toContain("No team members showing yet");
    expect(preview).toContain(
      "Add team members in Settings › Team &amp; hours and they show here.",
    );
  });
});
