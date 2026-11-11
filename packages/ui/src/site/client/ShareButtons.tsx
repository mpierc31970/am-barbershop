"use client";
// Share row island (07-24; CONT-27, D198; UI-SPEC "Social and sharing", copy 588 and 646;
// T-07-24-01, T-07-24-03).
//
// Plain share links only: no SDK, no script, nothing third-party loads until the visitor
// clicks. Hrefs come from core socialShareHref (http(s) page URLs only), so the links work
// without JS. Copy link is a button (clipboard, with a hidden-textarea fallback) that says
// "Link copied" for 2 s in a persistent role="status" region. Where the Web Share API
// exists, a first Share button opens the device sheet; it appears only after mount, so the
// first render equals the server markup. With no share data (the builder preview) every
// entry renders as an inert look-alike <span>.
import {
  SOCIAL_SHARE_LABELS,
  SOCIAL_SHARE_TARGETS,
  socialShareHref,
  type SocialShareTarget,
} from "@cds/core/content";
import { Link as LinkIcon, Mail, Share2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandIcon } from "../icons/BrandIcon";
import { BODY_CLASS } from "../types";

export interface ShareButtonsProps {
  targets: readonly SocialShareTarget[];
  share: { url: string; title: string } | null;
}

export const SHARE_COPIED_MS = 2000;

const BUTTON =
  `${BODY_CLASS} inline-flex min-h-11 items-center gap-2 rounded-site-button border ` +
  "border-site-text bg-transparent px-4 font-semibold leading-tight text-site-text " +
  "no-underline transition-colors duration-150 hover:bg-site-surface-raised cursor-pointer";
const ICON = { size: 20, "aria-hidden": true, focusable: false } as const;

function iconFor(target: SocialShareTarget): ReactNode {
  switch (target) {
    case "email":
      return <Mail {...ICON} />;
    case "copy":
      return <LinkIcon {...ICON} />;
    default:
      return <BrandIcon id={target} size={20} />;
  }
}

function fallbackCopy(value: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function ShareButtons({ targets, share }: ShareButtonsProps) {
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCanShare(
      share !== null &&
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function",
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [share]);

  const wanted = new Set(targets);
  const ordered = SOCIAL_SHARE_TARGETS.filter((t) => wanted.has(t));
  if (ordered.length === 0) return null;

  async function copy() {
    if (!share) return;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(share.url);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) ok = fallbackCopy(share.url);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), SHARE_COPIED_MS);
  }

  async function shareSheet() {
    if (!share) return;
    try {
      await navigator.share({ url: share.url, title: share.title });
    } catch {
      // AbortError (the visitor closed the sheet) or unsupported data: nothing to do.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className={`${BODY_CLASS} text-site-text-muted`}>Share this page</p>
      <ul className="flex min-h-[44px] flex-wrap gap-2">
        {canShare ? (
          <li>
            <button type="button" className={BUTTON} onClick={shareSheet}>
              <Share2 {...ICON} />
              Share
            </button>
          </li>
        ) : null}
        {ordered.map((t) => {
          const label = SOCIAL_SHARE_LABELS[t];
          const body = (
            <>
              {iconFor(t)}
              {label}
            </>
          );
          if (!share) {
            return (
              <li key={t}>
                <span className={BUTTON}>{body}</span>
              </li>
            );
          }
          if (t === "copy") {
            return (
              <li key={t}>
                <button type="button" className={BUTTON} onClick={copy}>
                  {body}
                </button>
              </li>
            );
          }
          const href = socialShareHref(t, share);
          if (!href) return null;
          return (
            <li key={t}>
              {t === "email" ? (
                <a href={href} className={BUTTON}>
                  {body}
                </a>
              ) : (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={BUTTON}
                >
                  {body}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <p role="status" className={`${BODY_CLASS} min-h-6 text-site-text`}>
        {copied ? "Link copied" : ""}
      </p>
    </div>
  );
}
