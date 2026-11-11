// DNS records and email setup chrome copy (14-32 choice 1; 14-UI-SPEC "DNS records",
// "AddRecordDialog", "RemoveRecordDialog", "Email setup"). Only the words without a UI-SPEC copy
// id live here; every REC-* / EMAIL-* / REPLACE-WARN sentence comes from `P14_COPY` in
// `@cds/core/dns` and is never retyped.

export const RECORDS_UI_COPY = Object.freeze({
  addTitle: "Add a record",
  addBody:
    "Most services, like Google, ask you to add a TXT record to check you own the domain. Paste exactly what they gave you.",
  typeLegend: "Type",
  txtDescription: "A line of text. Used by most verification checks.",
  cnameDescription:
    "Points a name to another address. Some services ask for this instead.",
  nameLabel: "Name",
  nameHelp: (domain: string) =>
    `Use @ for ${domain} itself, or the part before it, like em123 for em123.${domain}.`,
  fullName: (name: string) => `Full name: ${name}`,
  valueLabel: "Value",
  valueHelp: "Paste it exactly. Quotes are fine; we'll handle them.",
  adding: "Adding…",
  removing: "Removing…",
  removed: (type: string) => `${type} record removed.`,
  // Email setup
  stepOf: (n: number) => `Step ${n} of 3`,
  step1H: "Who provides your email?",
  step2H: (provider: string) => `Paste your values from ${provider}`,
  step3H: "Check and add",
  currentEmail: "Your current email",
  otherProvider: "Another provider",
  otherBody: "Support adds the records for you, usually within 1 business day.",
  notYet:
    "Don't have these yet? You can come back. Nothing changes until step 3.",
  noValues: "Fastmail needs nothing pasted. Choose Next to see the records.",
  spfLine: (include: string) => `Your one SPF record gains include:${include}`,
  pickProvider: "Choose who provides your email.",
  dkimFormat: (service: string, prefix: string) =>
    `That doesn't look like a ${service} DKIM value. It starts with ${prefix}.`,
  getEmail: "Get a professional email address",
  asked: (n: number) =>
    `Sent to Support as request #${n}. Support adds the records for you, usually within 1 business day.`,
  sendingAsk: "Sending…",
  loadingPreview: "Checking…",
});
