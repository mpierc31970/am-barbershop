"use client";
// ScreenHeader (11-15; DASH-17, D208, D110; 11-UI-SPEC "\"?\" on every screen";
// D-UI-P11-16). The screen's one H1 (Display 28/600) with a CircleHelp 20 "?" right after
// it, labelled "How {screen} works", plus optional right-aligned actions. With `onHelp`
// the "?" is a button (the app opens the TrainingDrawer for `helpId`); without it the "?"
// is a link to /hub/help/<helpId>, so it works without JavaScript. 11-47: inside the hub
// shell a HelpOpenerContext is present, so a plain left click on that link opens the how-to
// in the TrainingDrawer in place (`?help=<helpId>`); modifier/middle clicks still open the
// Help article.
import { CircleHelp } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useHelpOpener } from "./help-opener";
import type { HubLinkComponent } from "../AddonCard";
import { IconButton } from "../IconButton";
import { SHELL_COPY } from "./copy";

export interface ScreenHeaderProps {
  title: string;
  /** The how-to id of the screen (or of its current tab). */
  helpId: string;
  /** Name used in the "?" label when it differs from the title ("Pages" on Website). */
  helpName?: string;
  onHelp?: (helpId: string) => void;
  /** Right-aligned actions. */
  children?: ReactNode;
  LinkComponent?: HubLinkComponent;
}

export interface ScreenHelpProps {
  helpId: string;
  /** "How {name} works". */
  name: string;
  onHelp?: (helpId: string) => void;
  LinkComponent?: HubLinkComponent;
}

/**
 * The "?" control alone (11-47): ScreenHeader draws it after the H1; a screen with its own
 * header (the builder's page title) places it beside its title. One per screen.
 */
export function ScreenHelp({
  helpId,
  name,
  onHelp,
  LinkComponent,
}: ScreenHelpProps) {
  const label = SHELL_COPY.helpFor(name);
  const icon = <CircleHelp aria-hidden="true" size={20} strokeWidth={2} />;
  const Link = LinkComponent ?? "a";
  const opener = useHelpOpener();
  const onLinkClick = opener
    ? (e: MouseEvent<HTMLAnchorElement>) => {
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        ) {
          return;
        }
        e.preventDefault();
        opener(helpId);
      }
    : undefined;
  if (onHelp) {
    return (
      <IconButton label={label} icon={icon} onClick={() => onHelp(helpId)} />
    );
  }
  return (
    <Link
      href={SHELL_COPY.helpHref(helpId)}
      aria-label={label}
      title={label}
      onClick={onLinkClick}
      className={
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-hub-ink-muted " +
        "transition-colors duration-150 hover:bg-hub-surface-2 hover:text-hub-ink " +
        "pointer-coarse:h-11 pointer-coarse:w-11"
      }
    >
      {icon}
    </Link>
  );
}

export function ScreenHeader({
  title,
  helpId,
  helpName,
  onHelp,
  children,
  LinkComponent,
}: ScreenHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-hub text-hub-ink">
      <div className="flex min-w-0 items-center gap-1">
        <h1 className="text-[28px] leading-[1.2] font-semibold">{title}</h1>
        <ScreenHelp
          helpId={helpId}
          name={helpName ?? title}
          onHelp={onHelp}
          LinkComponent={LinkComponent}
        />
      </div>
      {children ? (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}
