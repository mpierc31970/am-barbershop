// Builder Pro display constants (BILL-14, D233, D234; 10-07). Pure. A manifest never carries
// a commercial figure: pricing lives in billing (D264). The $12 Standard / $0 Studio catalog
// rows are added in 10-11; Studio's $0 row is what makes it included there (10-17).
export const BUILDER_PRO_CONFIG = {
  slug: "builder-pro",
  name: "Builder Pro",
  summary:
    "Pro forms (show/hide rules, multi-step, file upload, auto-reply, answer-based routing, save and resume) and the Pro table.",
  category: "Website",
  order: 30,
  version: "1.0.0",
} as const;
