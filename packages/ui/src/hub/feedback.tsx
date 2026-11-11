// Hub feedback primitives: InlineAlert, EmptyState, Skeleton (03-UI-SPEC "Interaction
// states", "Copywriting Contract", "Accessibility contract"). Errors announce through
// role="alert"; everything else is quiet. Skeleton rows are aria-hidden placeholders,
// with a pulse that stops under prefers-reduced-motion.
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export type AlertTone = "error" | "info" | "success" | "warning";

const ALERT_TONES: Record<AlertTone, { box: string; Icon: typeof Info }> = {
  error: {
    box: "border-hub-danger bg-hub-danger-tint text-hub-danger",
    Icon: CircleAlert,
  },
  info: { box: "border-hub-border bg-hub-surface-2 text-hub-ink", Icon: Info },
  success: {
    box: "border-hub-success bg-hub-success-tint text-hub-success",
    Icon: CircleCheck,
  },
  warning: {
    box: "border-hub-warning bg-hub-warning-tint text-hub-warning",
    Icon: TriangleAlert,
  },
};

export interface InlineAlertProps {
  tone: AlertTone;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  /** Replaces the tone's default icon (e.g. PauseCircle for paused billing, 10-10). */
  icon?: typeof Info;
}

export function InlineAlert({
  tone,
  title,
  children,
  action,
  icon,
}: InlineAlertProps) {
  const { box, Icon: ToneIcon } = ALERT_TONES[tone];
  const Icon = icon ?? ToneIcon;
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`flex items-start gap-3 rounded border p-4 font-hub text-sm ${box}`}
    >
      <Icon aria-hidden size={20} strokeWidth={2} className="shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="text-hub-ink">{children}</div>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  heading: string;
  body: ReactNode;
  action?: ReactNode;
  /** Optional 20px lucide icon above the heading (e.g. Receipt for invoices, 10-10). */
  icon?: typeof Info;
}

export function EmptyState({
  heading,
  body,
  action,
  icon: Icon,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-2 rounded border border-dashed border-hub-border px-6 py-12 font-hub">
      {Icon ? (
        <Icon
          aria-hidden
          size={20}
          strokeWidth={2}
          className="text-hub-ink-muted"
        />
      ) : null}
      <h2 className="text-xl leading-tight font-semibold text-hub-ink">
        {heading}
      </h2>
      <p className="max-w-prose text-base text-hub-ink-muted">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export interface SkeletonProps {
  rows: number;
  /** Row height in px (multiple of 4). Default 56, the builder block row. */
  rowHeight?: number;
  /**
   * The ground the rows sit on. On a hub-surface-2 pane (the builder block list) the rows
   * use hub-border, so they stay visible. Default "surface".
   */
  ground?: "surface" | "surface-2";
}

export function Skeleton({
  rows,
  rowHeight = 56,
  ground = "surface",
}: SkeletonProps) {
  const fill = ground === "surface-2" ? "bg-hub-border" : "bg-hub-surface-2";
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: Math.max(0, rows) }, (_, i) => (
        <div
          key={i}
          data-skeleton-row=""
          style={{ height: rowHeight }}
          className={`animate-pulse rounded ${fill} motion-reduce:animate-none`}
        />
      ))}
    </div>
  );
}
