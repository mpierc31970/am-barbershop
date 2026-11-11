// Role names as the switcher and profile head show them. A plain module (not the client
// HubShell) so the server layout can call it.
const ROLE_LABEL: Readonly<Record<string, string>> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  staff: "Staff",
  renter: "Renter",
};

export function roleLabel(role: string): string {
  return Object.hasOwn(ROLE_LABEL, role) ? (ROLE_LABEL[role] ?? role) : role;
}
