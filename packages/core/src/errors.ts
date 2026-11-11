// Typed errors shared by the repository chokepoint and the app (TEN-06, TEN-15, D98, D287).
// Pure and Edge-safe. Plain classes with class fields only: no parameter properties and no
// enums, so Node type stripping can run these files directly (erasableSyntaxOnly).

/** Base class: every platform error carries a stable machine-readable `code`. */
export class CdsError extends Error {
  readonly code: string = "cds_error";
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The record does not exist, or exists in another organization (never reveal which). */
export class NotFound extends CdsError {
  override readonly code = "not_found";
}

/** The subject's role or grants do not allow this feature/action (fail closed). */
export class Forbidden extends CdsError {
  override readonly code = "forbidden";
}

/** An impersonating staff member tried a deny-listed action (TEN-15, D98). */
export class ImpersonationDenied extends CdsError {
  override readonly code = "impersonation_denied";
}

/** The change would leave an organization with no owner (TEN-06, D286). */
export class LastOwner extends CdsError {
  override readonly code = "last_owner";
}

/** The organization/actor context is missing or malformed (Invariant 1). */
export class InvalidContext extends CdsError {
  override readonly code = "invalid_context";
}

/** Caller-supplied data failed validation. */
export class InvalidInput extends CdsError {
  // Typed as string so subclasses (AddonManifestError) can refine the code.
  override readonly code: string = "invalid_input";
}

/** A tenant restore was refused (wrong org, bad snapshot, D287). */
export class RestoreRejected extends CdsError {
  override readonly code = "restore_rejected";
}

/** A staff action requires a completed MFA sign-in (TEN-15). */
export class MfaRequired extends CdsError {
  override readonly code = "mfa_required";
}

/**
 * AGR-02, D80: checkout and purchases refuse until the owner has signed the current policy
 * versions (requireCurrentSignature).
 */
export class AgreementRequired extends CdsError {
  override readonly code = "agreement_required";
  constructor(message = "Sign your agreement before you buy anything.") {
    super(message);
  }
}

/** Too many attempts from this client or against this account; retry later (WR-01). */
export class RateLimited extends CdsError {
  override readonly code = "rate_limited";
}

/**
 * P12 (D102, P12-P4): the target is locked by an active CDS service window. The default
 * message is the UI-SPEC LOCKED-BODY copy.
 */
export class TargetLocked extends CdsError {
  override readonly code = "target_locked";
  constructor(
    message = "You can look around, but changes are paused so nothing clashes with Support's fix.",
  ) {
    super(message);
  }
}
