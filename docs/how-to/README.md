---
type: doc
status: active
tags: [how-to, d110, plat-07, definition-of-done]
relatedTo: [cds-platform]
---

# How-tos

**The rule (D110):** every component and user-facing feature, core included, needs a how-to. A phase is **not done** until each component or feature it ships has one.

| Step | Do this                                               |
| ---- | ----------------------------------------------------- |
| 1    | Copy `TEMPLATE.md` to `docs/how-to/<feature-slug>.md` |
| 2    | Fill the frontmatter: `feature`, `phase`, `route`     |
| 3    | **Activate**: the exact steps to switch it on         |
| 4    | **Use**: the exact steps to use it once active        |
| 5    | Run `npm test`: it validates the structure            |

- Each step names the screen/route, the action and the observable result.
- Steps are the script for the Remotion + Venice AI videos, so write them to be recorded.
- Add-on how-tos also feed that add-on's `training/` module (Invariant 4).
- `tests/howto.test.ts` fails any file here (except this README and the template) that lacks either section or the `# | Screen / route | Action | Expected result` table.
