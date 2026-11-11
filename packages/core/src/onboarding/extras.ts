// Optional one-time extras offered under "Want help with any of these?" (D181). Labels and
// descriptions are data; prices come only from the price catalog (null until prices:set).

export type Extra = { key: string; label: string; description: string };

export const EXTRAS: readonly Extra[] = Object.freeze([
  {
    key: "copywriting",
    label: "Copywriting",
    description: "We write the words for your pages.",
  },
  {
    key: "logo-design",
    label: "Logo design",
    description: "A simple logo made for your business.",
  },
  {
    key: "sourced-photos",
    label: "Sourced photos",
    description: "We find licensed photos that fit your site.",
  },
  {
    key: "rush-launch",
    label: "Rush launch",
    description: "Your site goes to the front of the build queue.",
  },
]);
