// Settings › People & roles copy and view types (11-39; 11-UI-SPEC "Settings › People & roles"
// lines 847-873, Copywriting Contract PEOPLE-INTRO, ROLE-*, INVITE-*, IMPERSONATING-PEOPLE,
// ERR-SAVE, "Destructive actions"). Plain module: the server actions and the client
// components share it. Types are view shapes built on the server (never @cds/db rows).

export type PeopleRole =
  "owner" | "admin" | "editor" | "viewer" | "staff" | "renter";

/** Roles an Owner may give in the hub (D-UI-P11-22; mirrors @cds/db HUB_ASSIGNABLE_ROLES). */
export const INVITABLE_ROLES = ["admin", "editor", "viewer"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(v: unknown): v is InvitableRole {
  return (
    typeof v === "string" && (INVITABLE_ROLES as readonly string[]).includes(v)
  );
}

/** One person with access (the Owner row included). */
export interface PersonView {
  /** Membership id: what the row actions act on. */
  id: string;
  name: string;
  email: string;
  role: PeopleRole;
  grants: string[];
  isYou: boolean;
}

/** One pending invite. `sentOn` is already formatted on the server ("9 Oct"). */
export interface InviteView {
  id: string;
  email: string;
  role: PeopleRole;
  grants: string[];
  sentOn: string;
  expired: boolean;
}

/** An active add-on someone can be given access to (grant = its slug). */
export interface AddonAccessOption {
  slug: string;
  name: string;
}

export interface PeopleLists {
  people: PersonView[];
  invites: InviteView[];
}

export type PeopleResult =
  | { ok: true; data: PeopleLists }
  | { ok: false; code: string; message: string; field?: string };

export interface PeopleActions {
  invite(input: {
    email: string;
    role: InvitableRole;
    grants: string[];
  }): Promise<PeopleResult>;
  resend(inviteId: string): Promise<PeopleResult>;
  revoke(inviteId: string): Promise<PeopleResult>;
  changeRole(membershipId: string, role: InvitableRole): Promise<PeopleResult>;
  setGrants(membershipId: string, grants: string[]): Promise<PeopleResult>;
  remove(membershipId: string): Promise<PeopleResult>;
}

export const ROLE_LABEL: Record<PeopleRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  staff: "Staff",
  renter: "Renter",
};

/** ROLE-* (Copywriting Contract). */
export const ROLE_DESCRIPTION: Record<Exclude<PeopleRole, "owner">, string> = {
  admin:
    "Runs the site day to day: pages, messages, settings and add-ons. Can't pay, buy or download the site's data.",
  editor: "Edits pages and content and reads messages. Can't change settings.",
  viewer: "Sees pages, messages and reports. Can't change anything.",
  staff: "Sees only the add-ons you give them access to, such as bookings.",
  renter: "A chair or room renter. Sees only their own clients and bookings.",
};

/** Higher reaches more; lowering access asks to confirm. */
const ROLE_RANK: Record<PeopleRole, number> = {
  owner: 5,
  admin: 4,
  editor: 3,
  viewer: 2,
  staff: 1,
  renter: 0,
};

export function lowersAccess(from: PeopleRole, to: PeopleRole): boolean {
  return ROLE_RANK[to] < ROLE_RANK[from];
}

/** Owner and Admin reach every installed add-on without a grant (permissions). */
export function takesGrants(role: PeopleRole): boolean {
  return role !== "owner" && role !== "admin";
}

export const PEOPLE_COPY = {
  heading: "People who can use this hub",
  invite: "Invite someone",
  intro:
    "Everyone here signs in with their own email. Each person sees only what their role allows.",
  adminNote: "Only the site owner can invite people or change roles.",
  impersonating:
    "You're viewing as support staff, so changes to people are turned off.",
  empty: "Just you so far. Invite someone to help with your site.",
  colPerson: "Person",
  colRole: "Role",
  colAccess: "Add-on access",
  colStatus: "Status",
  colActions: "Actions",
  you: "You",
  allAddons: "All add-ons",
  none: "—",
  // Invite dialog
  inviteTitle: "Invite someone",
  email: "Email",
  role: "Role",
  roleMore:
    "Staff and Renter roles appear when you add an add-on that uses them.",
  access: "Add-on access",
  accessHelp:
    "They can open and edit these add-ons, nothing else beyond their role.",
  sendInvite: "Send invite",
  sending: "Sending invite…",
  notNow: "Not now",
  inviteInvalid: "Enter an email address like name@example.com.",
  // Change role
  changeRole: "Change role",
  saveRole: "Save role",
  saving: "Saving…",
  // Row menu
  resend: "Resend invite",
  cancelInvite: "Cancel invite",
  remove: "Remove from this site",
  removeConfirm: "Remove from this site",
  removing: "Removing…",
  removeBody:
    "They lose access straight away. Anything they made stays on your site.",
  undo: "Undo",
  errSave: "That didn't save. Check your connection and try again.",
} as const;

/** INVITE-EXISTS. */
export function inviteExistsCopy(email: string): string {
  return `${email} already has access to this site.`;
}

export function invitedStatus(sentOn: string): string {
  return sentOn ? `Invited · sent ${sentOn}` : "Invited";
}

export const INVITE_EXPIRED_STATUS = "Invite expired";

export function inviteSentCopy(email: string): string {
  return `Invite sent to ${email}.`;
}

export function inviteResentCopy(email: string): string {
  return `New invite sent to ${email}. The old link no longer works.`;
}

export function inviteCancelledCopy(email: string): string {
  return `Invite to ${email} cancelled.`;
}

function article(role: PeopleRole): string {
  return /^[aeiou]/i.test(ROLE_LABEL[role]) ? "an" : "a";
}

/** Toast "Sam is now an Editor." */
export function roleChangedCopy(name: string, role: PeopleRole): string {
  return `${name} is now ${article(role)} ${ROLE_LABEL[role]}.`;
}

export function accessSavedCopy(name: string): string {
  return `${name}'s add-on access is saved.`;
}

export function keepRoleLabel(role: PeopleRole): string {
  return `Keep ${ROLE_LABEL[role]}`;
}

export function lowerTitle(
  name: string,
  from: PeopleRole,
  to: PeopleRole,
): string {
  return `Change ${name} from ${ROLE_LABEL[from]} to ${ROLE_LABEL[to]}?`;
}

export function lowerBody(name: string, to: InvitableRole): string {
  return `${name} loses anything ${ROLE_LABEL[to]}s can't do, straight away. ${ROLE_DESCRIPTION[to]}`;
}

export function lowerConfirmLabel(to: PeopleRole): string {
  return `Make ${ROLE_LABEL[to]}`;
}

export function removeTitle(name: string, orgName: string): string {
  return `Remove ${name} from ${orgName}?`;
}

export function keepPersonLabel(name: string): string {
  return `Keep ${name}`;
}

export function removedCopy(name: string): string {
  return `${name} no longer has access.`;
}

export function moreLabel(who: string): string {
  return `More actions for ${who}`;
}

/** First name for buttons and toasts, else the email. */
export function shortName(p: { name: string; email: string }): string {
  const first = p.name.trim().split(/\s+/)[0];
  return first || p.email;
}

/** "Testimonials, Credentials", "All add-ons" for Owner/Admin, "—" when none. */
export function accessSummary(
  role: PeopleRole,
  grants: readonly string[],
  addons: readonly AddonAccessOption[],
): string {
  if (!takesGrants(role)) return PEOPLE_COPY.allAddons;
  const names = grants.map(
    (g) => addons.find((a) => a.slug === g)?.name ?? null,
  );
  const shown = names.filter((n): n is string => Boolean(n));
  return shown.length > 0 ? shown.join(", ") : PEOPLE_COPY.none;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shape check only; the server checks again. */
export function looksLikeEmail(v: string): boolean {
  return v.length <= 254 && EMAIL_SHAPE.test(v.trim());
}
