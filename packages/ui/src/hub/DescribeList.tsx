"use client";
// DescribeList: "Describe your photos", the D280 bulk backfill (07-17; CONT-14, CONT-35, D119,
// D120, D-UI-P7-5; 07-UI-SPEC "Describe photos", "Interaction states"). One <ol> of rows: a
// 96px thumb and a field "Description of IMG_2041.jpg" pre-filled with the name suggestion
// (selected on focus, so typing replaces it). Tab moves to the next field (no trap, no Enter
// submit); leaving a field with a changed, non-blank value saves it (useAutosave per row). A
// saved row collapses to "Saved: …" and the polite "N left" count drops. A suggestion that is
// already right is kept with a ghost "Use this" (WR-E07). A failed save shows
// "Not saved. Try again" on that row and keeps the value. All done: the done EmptyState.
import {
  useId,
  useState,
  type AnchorHTMLAttributes,
  type ComponentType,
} from "react";
import type { HubActionResult } from "./addon-types";
import { AutosaveStatus } from "./AutosaveStatus";
import { Button } from "./Button";
import { EmptyState } from "./feedback";
import { TextField } from "./fields";
import { useAutosave } from "./useAutosave";
import { MEDIA_COPY, leftCount, type DescribeRowView } from "./media/copy";

export interface DescribeListProps {
  rows: readonly DescribeRowView[];
  onSave(
    entries: { id: string; alt: string }[],
  ): Promise<HubActionResult<unknown>>;
  backHref: string;
  LinkComponent?: ComponentType<
    AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
  >;
}

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function DescribeRow({
  row,
  onSave,
  onSaved,
}: {
  row: DescribeRowView;
  onSave: DescribeListProps["onSave"];
  onSaved(id: string, alt: string): void;
}) {
  const id = useId();
  const [value, setValue] = useState(row.suggestion);
  // The last value sent; starts at the untouched suggestion, so only a changed value saves.
  const [sent, setSent] = useState<string | null>(row.suggestion.trim());
  const save = useAutosave<string>((alt) => onSave([{ id: row.id, alt }]), {
    onSaved: (_d, alt) => onSaved(row.id, alt),
    // A failed value may be sent again by leaving the field again.
    onFailed: () => setSent(null),
  });
  return (
    <li className="flex items-start gap-4" data-describe-row={row.id}>
      <img
        src={row.thumbUrl}
        alt=""
        loading="lazy"
        className="h-24 w-24 shrink-0 rounded bg-hub-surface-2 object-cover"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <TextField
          id={id}
          label={`Description of ${row.name}`}
          value={value}
          maxLength={250}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          onBlur={() => {
            const v = value.trim();
            if (v === "" || v === sent) return;
            setSent(v);
            save.run(v);
          }}
        />
        {value.trim() !== "" &&
        value.trim() === row.suggestion.trim() &&
        save.status !== "saving" ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            aria-label={`${MEDIA_COPY.describeUse}: ${value.trim()}`}
            onClick={() => {
              const v = value.trim();
              setSent(v);
              save.run(v);
            }}
          >
            {MEDIA_COPY.describeUse}
          </Button>
        ) : null}
        <AutosaveStatus
          state={save.status === "invalid" ? "error" : save.status}
          onRetry={() => {
            const v = value.trim();
            if (v === "") return;
            setSent(v);
            save.run(v);
          }}
        />
      </div>
    </li>
  );
}

export function DescribeList({
  rows,
  onSave,
  backHref,
  LinkComponent,
}: DescribeListProps) {
  const Link = LinkComponent ?? "a";
  const headingId = useId();
  const [saved, setSaved] = useState<ReadonlyMap<string, string>>(new Map());
  const left = rows.filter((r) => !saved.has(r.id)).length;

  function onSaved(id: string, alt: string) {
    setSaved((m) => new Map(m).set(id, alt));
  }

  const done = rows.length === 0 || left === 0;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-6 font-hub"
      data-describe-list=""
    >
      <p>
        <Link href={backHref} className={`text-sm ${LINK}`}>
          {MEDIA_COPY.allMedia}
        </Link>
      </p>
      <div className="flex flex-wrap items-baseline gap-4">
        <h2 id={headingId} className="text-xl leading-tight font-semibold">
          {MEDIA_COPY.describeHeading}
        </h2>
        <p
          aria-live="polite"
          className="text-sm text-hub-ink-muted tabular-nums"
        >
          {leftCount(left)}
        </p>
      </div>
      {done ? (
        <EmptyState
          heading={MEDIA_COPY.describeDoneHeading}
          body={MEDIA_COPY.describeDoneBody}
          action={
            <Link href={backHref} className={LINK}>
              {MEDIA_COPY.backToAll}
            </Link>
          }
        />
      ) : (
        <ol className="flex max-w-2xl flex-col gap-6">
          {rows.map((row) =>
            saved.has(row.id) ? (
              <li
                key={row.id}
                className="text-sm text-hub-ink-muted"
                data-describe-saved={row.id}
              >
                Saved: {saved.get(row.id)}
              </li>
            ) : (
              <DescribeRow
                key={row.id}
                row={row}
                onSave={onSave}
                onSaved={onSaved}
              />
            ),
          )}
        </ol>
      )}
    </section>
  );
}
