// Add-on errors (ADDON-01, ADDON-07). Class fields only (erasableSyntaxOnly).
import { CdsError, InvalidInput } from "../errors";

/** A manifest broke a build-time rule (CONTEXT A3-Q1). */
export class AddonManifestError extends InvalidInput {
  override readonly code = "addon_manifest_invalid";
}

/** The add-on is not installed/active for this organization. */
export class AddonNotActive extends CdsError {
  override readonly code = "addon_not_active";
}

/** Install refused: required add-ons are not active. */
export class AddonMissingRequirement extends CdsError {
  override readonly code = "addon_missing_requirement";
  readonly missing: string[];
  constructor(message: string, missing: string[]) {
    super(message);
    this.missing = missing;
  }
}

/** Install refused: a conflicting add-on is active. */
export class AddonConflict extends CdsError {
  override readonly code = "addon_conflict";
  readonly with: string;
  constructor(message: string, withSlug: string) {
    super(message);
    this.with = withSlug;
  }
}

/** Install refused: the add-on is not offered on the organization's path. */
export class AddonWrongPath extends CdsError {
  override readonly code = "addon_wrong_path";
}

/** Uninstall refused: active add-ons require this one. */
export class AddonRequiredBy extends CdsError {
  override readonly code = "addon_required_by";
  readonly dependents: string[];
  constructor(message: string, dependents: string[]) {
    super(message);
    this.dependents = dependents;
  }
}
