// The five CDS policy links for client-rendered frames (09-09; /start footer). A literal copy
// so client bundles never pull the compiled policy texts (@cds/core/legal POLICY_SET);
// apps/web/test/legal-pages.test.ts fails if it drifts from the active policy set.
export const LEGAL_LINKS: readonly { href: string; title: string }[] =
  Object.freeze([
    { href: "/legal/service-agreement", title: "Service Agreement" },
    { href: "/legal/acceptable-use", title: "Acceptable Use Policy" },
    { href: "/legal/terms-of-service", title: "Terms of Service" },
    { href: "/legal/subscription-terms", title: "Subscription terms" },
    { href: "/legal/dpa", title: "Data Processing Agreement" },
  ]);
