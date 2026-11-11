// P8 (08-14) About slot 4 `faq` (08-UI-SPEC About row 4 and "FAQ answers"; TMPL-01;
// D-UI-P8-11; T-08-14-03). The Suggested "Questions and answers" preset with the business
// type's starters. Only answers the CopyWriter can state from facts are filled (prices only
// when Home placed Services: `env.placed` carries Home's slots when About is filled); the
// rest stay "" and so stay hidden on the site (P7). Always placed; reported for polish when
// any answer is empty. Answers are escaped through html.ts.
import type { FaqBlockContent } from "@cds/core/content";
import { SUGGESTED_PRESETS } from "@cds/core/content/presets";
import { SLOT_LABELS, type Slot } from "@cds/core/templates";
import { readFacts } from "../facts";
import { paragraphs } from "../html";
import { presetContext } from "./shared";

export const faqSlot: Slot = {
  name: "faq",
  label: SLOT_LABELS.faq!,
  fill(intake, env) {
    const f = readFacts(intake);
    const preset = SUGGESTED_PRESETS.find((p) => p.id === "faq")!;
    const built = preset.build(presetContext(f, env))[0]!;
    const content = built.content as FaqBlockContent;
    const items = content.items.map((item) => ({
      ...item,
      answer: paragraphs(env.copy.faqAnswer(item.question, f, env.placed)),
    }));
    const total = items.length;
    const unanswered = items.filter((i) => i.answer === "").length;
    return {
      blocks: [{ ...built, content: { ...content, items } }],
      source: unanswered < total ? "provided" : "fallback",
      ...(unanswered > 0
        ? {
            polish: [
              `Questions and answers · ${unanswered} of ${total} need answers; they stay hidden until answered`,
            ],
          }
        : {}),
    };
  },
};
