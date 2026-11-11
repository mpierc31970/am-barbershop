// "./admin": Builder Pro has no hub screen (nav.placement "none") and no block form. The
// registry contract needs a Panel; it renders nothing and no route reaches it (10-07).
export function Panel(): null {
  return null;
}

export const blockForms = {};
