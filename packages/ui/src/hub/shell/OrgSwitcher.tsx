"use client";
// Org switcher (11-15; DASH-18, D286; 11-UI-SPEC "Org switcher"; D-UI-P11-3, D-UI-P11-4).
// Trigger: Body 600 business name + ChevronsUpDown 16 (max 240px, truncate), named
// "Switch site, current: {site}". Menu: a 320px popover listbox, one 48px row per active
// site with the person's role there; the current one carries Check 16 and
// aria-selected="true". Sorted current first, then by name. Choosing another site shows
// "Switching…" in its row and calls onSwitch(id); the app's server action sets the cookie
// and redirects to /hub/today. Renders nothing for fewer than two sites.
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { SHELL_COPY } from "./copy";
import { usePopover } from "./usePopover";

export interface ShellOrg {
  id: string;
  /** Business name. */
  name: string;
  /** The person's role at this site, as shown ("Owner", "Staff", "Renter"). */
  role: string;
}

export interface OrgSwitcherProps {
  orgs: readonly ShellOrg[];
  currentId: string;
  /** Switches site; a rejected promise clears the "Switching…" row. */
  onSwitch: (id: string) => void | Promise<unknown>;
}

export function sortOrgs(
  orgs: readonly ShellOrg[],
  currentId: string,
): ShellOrg[] {
  return [...orgs].sort((a, b) => {
    if (a.id === currentId) return -1;
    if (b.id === currentId) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function OrgSwitcher({ orgs, currentId, onSwitch }: OrgSwitcherProps) {
  const { open, setOpen, close, anchorRef } = usePopover();
  const sorted = useMemo(() => sortOrgs(orgs, currentId), [orgs, currentId]);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const current = sorted.find((o) => o.id === currentId) ?? sorted[0];

  useEffect(() => {
    if (!open) return;
    setActive(0);
    listRef.current?.focus();
  }, [open]);

  if (orgs.length < 2 || !current) return null;

  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const choose = (org: ShellOrg) => {
    if (pending) return;
    if (org.id === currentId) {
      close();
      return;
    }
    setPending(org.id);
    try {
      const result = onSwitch(org.id);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).catch(() => setPending(null));
      }
    } catch {
      setPending(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = sorted.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (i >= last ? 0 : i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (i <= 0 ? last : i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ": {
        e.preventDefault();
        const org = sorted[active];
        if (org) choose(org);
        break;
      }
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={anchorRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={SHELL_COPY.switchName(current.name)}
        onClick={() => setOpen(!open)}
        className={
          "inline-flex h-10 max-w-[240px] min-w-0 items-center gap-2 rounded px-2 font-hub " +
          "text-base font-semibold text-hub-ink transition-colors duration-150 " +
          "hover:bg-hub-surface-2 active:bg-hub-border pointer-coarse:min-h-11"
        }
      >
        <span className="truncate">{current.name}</span>
        <ChevronsUpDown
          aria-hidden="true"
          size={16}
          strokeWidth={2}
          className="shrink-0 text-hub-ink-muted"
        />
      </button>
      {open ? (
        <div
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label={SHELL_COPY.switcherListLabel}
          aria-activedescendant={optionId(active)}
          aria-busy={pending ? true : undefined}
          onKeyDown={onKeyDown}
          className={
            "absolute top-full left-0 z-40 mt-1 w-[320px] max-w-[calc(100vw-32px)] rounded " +
            "border border-hub-border bg-hub-surface py-1 font-hub text-hub-ink shadow-lg " +
            "focus:outline-none"
          }
        >
          {sorted.map((org, i) => {
            const selected = org.id === currentId;
            const switching = pending === org.id;
            return (
              <div
                key={org.id}
                id={optionId(i)}
                role="option"
                aria-selected={selected}
                onClick={() => choose(org)}
                onMouseMove={() => setActive(i)}
                className={
                  "flex min-h-12 cursor-pointer items-center gap-3 px-4 py-1 " +
                  (i === active ? "bg-hub-surface-2" : "")
                }
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-semibold">
                    {org.name}
                  </span>
                  <span className="text-sm text-hub-ink-muted">
                    {switching ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2
                          aria-hidden="true"
                          size={14}
                          strokeWidth={2}
                          className="animate-spin motion-reduce:animate-none"
                        />
                        {SHELL_COPY.switching}
                      </span>
                    ) : (
                      org.role
                    )}
                  </span>
                </span>
                {selected ? (
                  <Check
                    aria-hidden="true"
                    size={16}
                    strokeWidth={2}
                    className="shrink-0"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
