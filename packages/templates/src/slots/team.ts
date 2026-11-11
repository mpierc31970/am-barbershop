// P8 (08-14) About slot 2 `team` (08-UI-SPEC About row 2; TMPL-01, TMPL-02; D253). The
// data-bound Our team block: content holds display options only, members come live from the
// org's team list. Heading names the member for exactly one published member, else "Our team".
// No published members -> Left out. Note = the published count.
import { SLOT_LABELS, type Slot } from "@cds/core/templates";
import { readFacts } from "../facts";
import { defaultsOf } from "./shared";

export const teamSlot: Slot = {
  name: "team",
  label: SLOT_LABELS.team!,
  fill(intake) {
    const f = readFacts(intake);
    const members = f.team; // published only (readFacts)
    if (members.length === 0) {
      return { blocks: [], source: "omitted", note: "No team members" };
    }
    // readFacts only checks id and is_published: a malformed name must not throw (WR-B02).
    const name: unknown = members[0]!.name;
    const only =
      members.length === 1 && typeof name === "string" ? name.trim() : "";
    const heading = only !== "" ? `Meet ${only}` : "Our team";
    return {
      blocks: [
        {
          section_type: "team",
          row_layout: "full",
          content: {
            ...defaultsOf("team"),
            heading,
            show_roles: true,
            show_bios: true,
          },
        },
      ],
      source: "provided",
      note: String(members.length),
    };
  },
};
