/// <reference path="../pb_data/types.d.ts" />
// 09-03 (AGR-01, AGR-05, AGR-08, D283; CONTEXT A1-Q2, A2-Q2, A5-Q3; RESEARCH Pattern 3):
// the legal collections are append-only. Every app write uses a superuser client, and
// superuser writes bypass API rules (invariant 1 note), so the guard has to be a MODEL
// hook (onRecordUpdate / onRecordDelete), which fires for every save path: API including
// superuser, app.save, migrations and cascades. The *Request variants would miss app saves.
// - agreement_signatures, site_policy_acks: never updated; deleted only once retain_until
//   has passed (the retention job, LIFE-02).
// - policy_versions: content never changes; only status active -> retired; never deleted.
// audit_log deliberately has NO hook here (RESEARCH Pitfall 6).
// Dates are compared with getDateTime(...).unix() against new DateTime(), never by parsing
// a PB date string in JS (RESEARCH Pitfall 10).
// PB JSVM handlers run in isolated VMs (no shared top-level helpers), so each handler is
// self-contained. Hooks cannot stop shell edits to data.db; the *_sha256 fields and the
// write-once document copy make those detectable (T-09-03-04).

onRecordUpdate(
  (e) => {
    throw new BadRequestError("agreement records are append-only");
  },
  "agreement_signatures",
  "site_policy_acks",
);

onRecordDelete(
  (e) => {
    const until = e.record.getDateTime("retain_until");
    if (until.isZero() || until.unix() > new DateTime().unix()) {
      throw new BadRequestError("kept until retain_until (D283)");
    }
    e.next();
  },
  "agreement_signatures",
  "site_policy_acks",
);

onRecordUpdate((e) => {
  const o = e.record.original();
  const fixed = [
    "key",
    "version",
    "title",
    "summary",
    "changes",
    "body_md",
    "sha256",
    "effective_at",
    "draft",
  ];
  for (const f of fixed) {
    if (o.getString(f) !== e.record.getString(f)) {
      throw new BadRequestError(
        "policy versions are immutable; publish a new version",
      );
    }
  }
  if (!(
    o.getString("status") === "active" &&
    e.record.getString("status") === "retired"
  )) {
    throw new BadRequestError("only active -> retired is allowed");
  }
  e.next();
}, "policy_versions");

onRecordDelete((e) => {
  throw new BadRequestError("policy versions are never deleted");
}, "policy_versions");
