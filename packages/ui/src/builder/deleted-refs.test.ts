// deletedRefLabel (07-28; CONT-36, UI-SPEC "Soft-delete in the builder").
import { describe, expect, it } from "vitest";
import {
  DELETED_POPUP_COPY,
  DELETED_REF_LABELS,
  deletedRefLabel,
} from "./deleted-refs";

const none = { forms: [], popups: [], media: [] };

describe("deletedRefLabel", () => {
  it("names a deleted form", () => {
    expect(
      deletedRefLabel(
        { forms: ["f1"], popups: [], media: [] },
        { ...none, forms: ["f1"] },
      ),
    ).toBe("Uses a deleted form");
  });

  it("names a deleted pop-up and deleted media", () => {
    expect(
      deletedRefLabel(
        { forms: [], popups: ["p1"], media: [] },
        { ...none, popups: ["p1"] },
      ),
    ).toBe("Uses a deleted pop-up");
    expect(
      deletedRefLabel(
        { forms: [], popups: [], media: ["m1"] },
        { ...none, media: ["m1"] },
      ),
    ).toBe("Uses deleted media");
  });

  it("several kinds: the form label first, then pop-up, then media", () => {
    const refs = { forms: ["f1"], popups: ["p1"], media: ["m1"] };
    expect(
      deletedRefLabel(refs, { forms: ["f1"], popups: ["p1"], media: ["m1"] }),
    ).toBe(DELETED_REF_LABELS.forms);
    expect(
      deletedRefLabel(refs, { forms: [], popups: ["p1"], media: ["m1"] }),
    ).toBe(DELETED_REF_LABELS.popups);
  });

  it("nothing deleted, or another block's ids, gives null", () => {
    expect(
      deletedRefLabel({ forms: ["f1"], popups: [], media: [] }, none),
    ).toBeNull();
    expect(
      deletedRefLabel(
        { forms: ["f1"], popups: [], media: [] },
        { ...none, forms: ["f2"] },
      ),
    ).toBeNull();
    expect(deletedRefLabel(null, none)).toBeNull();
  });

  it("the pop-up picker copy is the UI-SPEC DELETED-REF variant", () => {
    expect(DELETED_POPUP_COPY).toBe(
      "This pop-up was deleted. It still opens here so nothing breaks; choose another pop-up or change this button.",
    );
  });
});
