// /test-pay/<id>: the fake adapter's hosted checkout and hosted invoice page (10-23; CONTEXT
// A1, UI-SPEC "Test pages"). A checkout session (`cs_fake_…`) or an open invoice (`in_fake_…`:
// quote deposit, balance, remaining installments) of the caller's org shows its lines and
// total exactly as stored, the test-mode tax line and the outcome buttons. Each button posts
// the hidden id and an `outcome` to submitTestPayment, which emits through the real processor
// and redirects to the success or cancel URL. Robots: noindex (layout and here).
import { formatCentsExact } from "@cds/core/pricing";
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { submitTestPayment } from "../../../actions/test-pay";
import { requireHubSession } from "../../../../lib/session";
import {
  TEST_PAY_FAILED,
  TEST_PAY_TAX,
  loadTestPayment,
  testPayDisabled,
  type TestPayView,
} from "../../../../lib/test-pay";
import { TestPayExpired } from "../TestPayExpired";

export const metadata: Metadata = {
  title: "Test payment",
  robots: "noindex, nofollow",
};

export const dynamic = "force-dynamic";

const TITLE = "Pay Connections Design Studios";

type Search = { error?: string | string[] };

export default async function TestPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  if (testPayDisabled()) notFound();
  const { ctx } = await requireHubSession();
  const { id } = await params;
  const sp = await searchParams;

  let view: TestPayView | null = null;
  try {
    view = await loadTestPayment(ctx, id);
  } catch (err) {
    console.error(
      "[test-pay] load failed",
      err instanceof Error ? err.name : typeof err,
    );
    view = null;
  }
  if (!view) return <TestPayExpired title={TITLE} />;

  const total = formatCentsExact(view.totalCents);
  return (
    <>
      <h1 className="text-2xl leading-tight font-semibold text-hub-ink">
        {TITLE}
      </h1>
      {sp.error === "1" ? (
        <InlineAlert tone="error">{TEST_PAY_FAILED}</InlineAlert>
      ) : null}
      <table className="w-full text-sm text-hub-ink">
        <tbody>
          {view.lines.map((line, i) => (
            <tr key={i} className="border-b border-hub-border">
              <td className="py-2 pr-4">{line.label}</td>
              <td className="py-2 text-right tabular-nums">
                {formatCentsExact(line.amountCents)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="py-2 pr-4 text-left font-semibold">
              Total
            </th>
            <td className="py-2 text-right font-semibold tabular-nums">
              {total}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="text-sm font-semibold text-hub-ink-muted">{TEST_PAY_TAX}</p>
      <form action={submitTestPayment} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={view.id} />
        <button
          type="submit"
          name="outcome"
          value="pay"
          className={buttonClasses("primary")}
        >
          Pay {total} (test)
        </button>
        <button
          type="submit"
          name="outcome"
          value="decline"
          className={buttonClasses("destructive")}
        >
          Decline card
        </button>
        {view.kind === "session" && !view.tenantSide ? (
          <button
            type="submit"
            name="outcome"
            value="fail_later"
            className={buttonClasses("ghost")}
          >
            Card fails later
          </button>
        ) : null}
      </form>
      <a href={view.backHref} className={buttonClasses("ghost")}>
        Back to the hub
      </a>
    </>
  );
}
