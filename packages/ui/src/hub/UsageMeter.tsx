// UsageMeter: the 2 GB media allowance (07-17; CONT-19, D278, D-UI-P7-9; 07-UI-SPEC "Media"
// header). Label "1.2 GB of 2 GB used" (tabular) over a 4px bar on the border track: ink fill
// below 80%, warning 80-99%, danger at 100%; never accent. At warn it adds the USAGE-80
// InlineAlert; at full the header swaps Upload files for USAGE-FULL (MediaUploadButton).
// The label and message are built on the server from @cds/db copy (choice 2).
// 10-43 (BILL-13, D-UI-P10-18): at warn, a server-set `storageHref` (Owner only) adds the
// "Add storage" link to Settings › Billing inside the alert.
import { InlineAlert } from "./feedback";
import { MEDIA_COPY, type UsageView } from "./media/copy";

export interface UsageMeterProps {
  usage: UsageView;
  /** The meter's aria-label (10-05: "Care Plan minutes used"). Default: media storage. */
  label?: string;
}

export function UsageMeter({
  usage,
  label = "Media storage used",
}: UsageMeterProps) {
  const ratio = Math.min(1, Math.max(0, usage.ratio));
  const pct = Math.round(ratio * 100);
  const fill =
    usage.level === "full" || ratio >= 1
      ? "bg-hub-danger"
      : ratio >= 0.8
        ? "bg-hub-warning"
        : "bg-hub-ink";
  return (
    <div className="flex flex-col gap-3 font-hub" data-usage-meter="">
      <div className="flex max-w-[360px] flex-col gap-2">
        <p className="text-sm text-hub-ink-muted tabular-nums">{usage.label}</p>
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={usage.label}
          className="h-1 w-full overflow-hidden rounded-full bg-hub-border"
        >
          <div
            data-usage-fill={usage.level}
            className={`h-full ${fill}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {usage.level === "warn" && usage.message ? (
        <InlineAlert
          tone="warning"
          action={
            usage.storageHref ? (
              <a
                href={usage.storageHref}
                data-add-storage=""
                className="font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
              >
                {MEDIA_COPY.addStorage}
              </a>
            ) : undefined
          }
        >
          {usage.message}
        </InlineAlert>
      ) : null}
    </div>
  );
}
