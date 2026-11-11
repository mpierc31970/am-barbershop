// The seven intake stages, in order (CONTEXT A3-Q2, UI-SPEC "Stages"). Data, not code.
export const STAGES = [
  { slug: "business", name: "Your business" },
  { slug: "contact", name: "Contact & hours" },
  { slug: "email", name: "Email" },
  { slug: "words", name: "Your words & services" },
  { slug: "people", name: "People & proof" },
  { slug: "look", name: "Photos & look" },
  { slug: "the-rest", name: "Domain & the rest" },
] as const;

export type StageSlug = (typeof STAGES)[number]["slug"];

export function isStageSlug(raw: unknown): raw is StageSlug {
  return typeof raw === "string" && STAGES.some((s) => s.slug === raw);
}

/** Week starts Monday (D-UI-P6-22). */
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

export const DAY_LABELS: Readonly<Record<Day, string>> = Object.freeze({
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
});
