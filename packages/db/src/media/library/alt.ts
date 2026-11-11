// Media library names and descriptions (07-12; CONT-14, CONT-35, D280, D-UI-P7-5). Pure.
//   - cleanFileName: the stored `name` of an upload (no path, no control characters)
//   - altSuggestionFromName: a description pre-fill from a human file name; camera-style names
//     ("IMG_2041.JPG") suggest nothing. 07-22's gallery bulk add reuses it.
//   - ALT_REQUIRED_COPY: refusal of a blank description. The UI-SPEC has no blank-save copy;
//     this wording is an unattended discretion choice (recorded in 07-12-SUMMARY).

export const ALT_REQUIRED_COPY =
  "Add a description so everyone knows what the photo shows.";

export const FILE_NAME_MAX = 200;
const SUGGESTION_MAX = 250;

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

/** The display name of an upload: last path segment, no control characters or leading dots. */
export function cleanFileName(name: unknown): string {
  if (typeof name !== "string") return "Untitled";
  const last = name.split(/[\\/]/).pop() ?? "";
  const cleaned = last
    .replace(/\s+/g, " ")
    .replace(CONTROL_RE, "")
    .trim()
    .replace(/^\.+/, "")
    .trim()
    .slice(0, FILE_NAME_MAX)
    .trim();
  return cleaned === "" ? "Untitled" : cleaned;
}

// Names a camera, phone or screenshot tool gives: they say nothing about the photo.
const CAMERA_RES: readonly RegExp[] = [
  /^(img|dsc|dscn|dscf|dcim|pxl|mvimg|gopr|gp|dji|vid|photo|image|pic|scan|wp|sam|p)[\s_-]*\d/i,
  /^screen\s?shot\b/i,
  /^screenshot/i,
  /^\d[\d\s_.-]*$/,
];

/** "loaves-cooling_on-rack.jpg" -> "Loaves cooling on rack"; camera-style names -> "". */
export function altSuggestionFromName(name: unknown): string {
  if (typeof name !== "string") return "";
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(CONTROL_RE, "")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .trim();
  if (base === "") return "";
  if (CAMERA_RES.some((re) => re.test(base))) return "";
  const words = base
    .split(/[-_.\s]+/)
    .filter((w) => w !== "")
    .join(" ")
    .toLowerCase();
  if (!/[a-z]/.test(words)) return "";
  const text = words.charAt(0).toUpperCase() + words.slice(1);
  return text.slice(0, SUGGESTION_MAX).trim();
}
