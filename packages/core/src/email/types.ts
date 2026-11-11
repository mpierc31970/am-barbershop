// Email type contract (EMAIL-01, D267). Pure types.

/** Suppression rules depend on the class: marketing honours unsubscribes, transactional does not. */
export type EmailClass = "transactional" | "marketing";

/** Routing purposes an org can send to different addresses (ONB-09). */
export type EmailPurpose =
  "default" | "inquiries" | "newsletter" | "billing" | "account";

export type EmailTypeSpec = {
  class: EmailClass;
  /** "core" or the owning add-on slug. */
  owner: string;
  description: string;
  /** "pb" types are sent by PocketBase (OTP template), never by the app pipeline. */
  sentBy?: "app" | "pb";
};
