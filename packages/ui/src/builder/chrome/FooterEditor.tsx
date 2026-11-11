"use client";
// Site footer editor (07-25 choice 10; CONT-13, D249; UI-SPEC "Footer" lines 482-486).
//
// Three switches (address, hours, social links; all on by default), the extra links list
// (the shared LinkListEditor without nesting, up to 6), the copyright line with the {year}
// helper, and the fixed Report note with a Lock icon: the Report link is not a setting and
// nothing here can hide it (D249). Controlled; hub primitives only.
import {
  FOOTER_COPY,
  FOOTER_COPYRIGHT_MAX,
  FOOTER_LINKS_MAX,
  type FooterSettings,
  type NavItem,
} from "@cds/core/content";
import { Lock } from "lucide-react";
import { TextField } from "../../hub/fields";
import { Switch } from "../../hub/Switch";
import { LinkListEditor, type ChromePageOption } from "./LinkListEditor";

export interface FooterEditorProps {
  value: FooterSettings;
  onChange: (next: FooterSettings) => void;
  pages: readonly ChromePageOption[];
  businessName: string;
}

const FOOTER_LIMITS = { top: FOOTER_LINKS_MAX, children: 0 };

export function FooterEditor({
  value,
  onChange,
  pages,
  businessName,
}: FooterEditorProps) {
  const items: NavItem[] = value.extra_links.map((l) => ({
    ...l,
    children: [],
  }));
  const set = <K extends keyof FooterSettings>(k: K, v: FooterSettings[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="flex flex-col gap-8 font-hub text-hub-ink">
      <section
        aria-labelledby="footer-show-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="footer-show-heading" className="text-base font-semibold">
          What your footer shows
        </h2>
        <Switch
          id="footer-address"
          label="Show your address"
          checked={value.show_address}
          onChange={(v) => set("show_address", v)}
        />
        <Switch
          id="footer-hours"
          label="Show opening hours"
          checked={value.show_hours}
          onChange={(v) => set("show_hours", v)}
        />
        <Switch
          id="footer-socials"
          label="Show social links"
          checked={value.show_socials}
          onChange={(v) => set("show_socials", v)}
        />
      </section>

      <section
        aria-labelledby="footer-links-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="footer-links-heading" className="text-base font-semibold">
          Extra links
        </h2>
        <p className="text-sm text-hub-ink-muted">
          For pages like Privacy or Terms. Up to {FOOTER_LINKS_MAX}.
        </p>
        <LinkListEditor
          items={items}
          onChange={(next) =>
            set(
              "extra_links",
              next.map((i) => ({
                id: i.id,
                label: i.label,
                target: i.target,
                new_tab: i.new_tab,
              })),
            )
          }
          pages={pages}
          nesting={false}
          limits={FOOTER_LIMITS}
          limitCopy={FOOTER_COPY.linksLimit}
          place="footer"
          addVerb="Add to footer"
          idPrefix="footer-link"
        />
      </section>

      <TextField
        id="footer-copyright"
        label="Copyright line"
        value={value.copyright}
        placeholder={`© {year} ${businessName || "{name}"}`}
        helper={FOOTER_COPY.copyrightHelp}
        counter={{ value: value.copyright.length, max: FOOTER_COPYRIGHT_MAX }}
        onChange={(e) => set("copyright", e.currentTarget.value)}
      />

      <p className="flex items-start gap-2 text-sm text-hub-ink-muted">
        <Lock
          aria-hidden
          size={16}
          strokeWidth={2}
          className="mt-0.5 shrink-0"
        />
        {FOOTER_COPY.reportNote}
      </p>
    </div>
  );
}
