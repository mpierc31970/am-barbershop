/// <reference path="../pb_data/types.d.ts" />
// STAFF-09, D96 (P13-P6): canned replies for the staff ticket composer. A platform
// collection: any staff member creates and edits, nobody deletes (archived_at instead).
// Bodies use only the placeholders {first_name}, {business}, {ticket}, {agent}; they are
// filled on insert and unknown placeholders are refused (renderCanned, 13-15).
// created_by / updated_by are staff ids (serverOnly in BROWSER_FIELDS); the seeds are system
// rows, so created_by stays empty. All API rules null (invariant 1).
const SEED = [
  {
    title: "Welcome",
    body: "Hi {first_name},\n\nThanks for getting in touch. I'm {agent} and I'll be looking after ticket {ticket} for {business}. I'll reply here as soon as I have an update.",
  },
  {
    title: "Need more detail",
    body: "Hi {first_name},\n\nThanks for the note. To get this right, could you tell me a bit more? Which page is it on, what did you expect to see, and what happened instead? A screenshot helps too.\n\n{agent}",
  },
  {
    title: "How-to link",
    body: "Hi {first_name},\n\nGood news: you can do this yourself in a minute. The steps are in Help, under the how-to for this part of your site. If anything there doesn't match what you see, reply here and I'll walk you through it.\n\n{agent}",
  },
  {
    title: "Paid service explained",
    body: "Hi {first_name},\n\nThis one is outside what your plan includes, so it would be paid work. I'll send you a quote on this ticket with the scope and the price. Nothing is charged unless you accept it.\n\n{agent}",
  },
  {
    title: "Fixed, please confirm",
    body: "Hi {first_name},\n\nThis should be fixed now. Could you take a look on your site and let me know it works for you? If it does, there's nothing else to do. I'll mark ticket {ticket} resolved.\n\n{agent}",
  },
  {
    title: "Closing the ticket",
    body: "Hi {first_name},\n\nI'm marking ticket {ticket} resolved. If anything comes up again, just reply here within 7 days and it reopens. After that, open a new ticket any time.\n\nThanks,\n{agent}",
  },
  {
    title: "Billing hand-off",
    body: "Hi {first_name},\n\nThis is a billing question, so I've passed ticket {ticket} to the person who handles billing for {business}. You'll get the answer here on this ticket.\n\n{agent}",
  },
  {
    title: "Known problem",
    body: "Hi {first_name},\n\nThanks for reporting this. It's a known problem we're already working on, and I've linked ticket {ticket} to it. You'll get an update here as soon as it's fixed. There's nothing you need to do.\n\n{agent}",
  },
];

migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "canned_replies",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "title", required: true, max: 80 },
        { type: "text", name: "body", required: true, max: 5000 },
        { type: "text", name: "created_by", max: 15 },
        { type: "text", name: "updated_by", max: 15 },
        { type: "date", name: "archived_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_canned_replies_archived_at ON canned_replies (archived_at)",
      ],
    });
    app.save(collection);

    for (const seed of SEED) {
      const record = new Record(collection);
      record.set("title", seed.title);
      record.set("body", seed.body);
      app.save(record);
    }
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("canned_replies"));
  },
);
