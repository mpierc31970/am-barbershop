"use client";
// The console area "?" (13-25 choice 3; P13-P12; 13-UI-SPEC "Tabs": "?" opens that area's
// how-to). A CircleHelp IconButton labelled "How {area} works" opening a right Drawer with the
// article's Activate and Use steps (screen, action, expected). Rendered only when the area's
// slug exists in STAFF_HELP (the page decides), so it never points at a missing article.
// Steps go through the hub's inlineMarks (13-51): bold and code render, and `.md` links (staff
// articles have no page of their own) render as their plain label.
import type { StaffHelpArticle } from "@cds/addon-registry/staff-help";
import { Drawer, IconButton } from "@cds/ui/hub";
import { inlineMarks } from "@cds/ui/hub/help";
import { CircleHelp, X } from "lucide-react";
import { useState } from "react";

function Steps({
  heading,
  steps,
}: {
  heading: string;
  steps: StaffHelpArticle["use"];
}) {
  if (steps.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">{heading}</h3>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
        {steps.map((s, i) => (
          <li key={i}>
            <p className="text-hub-ink-muted">
              {inlineMarks(s.screen, undefined, "a")}
            </p>
            <p>{inlineMarks(s.action, undefined, "a")}</p>
            <p className="text-hub-ink-muted">
              {inlineMarks(s.expected, undefined, "a")}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function StaffHelpDrawer({
  name,
  article,
}: {
  name: string;
  article: StaffHelpArticle;
}) {
  const [open, setOpen] = useState(false);
  const label = `How ${name} works`;
  return (
    <>
      <IconButton
        label={label}
        icon={<CircleHelp aria-hidden="true" size={20} strokeWidth={2} />}
        onClick={() => setOpen(true)}
      />
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        label={article.title}
        side="right"
      >
        <div className="flex flex-col gap-5 p-5 font-hub text-hub-ink">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-semibold">{article.title}</h2>
            <IconButton
              label="Close"
              icon={<X aria-hidden="true" size={16} />}
              onClick={() => setOpen(false)}
            />
          </div>
          <Steps heading="Turn it on" steps={article.activate} />
          <Steps heading="Use it" steps={article.use} />
        </div>
      </Drawer>
    </>
  );
}
