"use client";
// The signing form (09-17; AGR-03, AGR-07; CONTEXT A2-Q1, A6-Q2; D216, D287, D-UI-P9-5,
// D-UI-P9-6; 09-UI-SPEC "Signing screen", "Re-accept"). Owns the ticks, the consent tick,
// the typed name, pending and the error; the @cds/ui/hub/legal components are controlled.
// One box per policy, never pre-ticked, nothing that ticks them together (D216). Ticks are
// keyed by policy key AND sha256, so after ERR-STALE's refresh a changed policy is unticked
// while unchanged ones and the typed name stay (choice 5). Success navigates to the signed
// confirmation (choice 1).
import { AcceptProgress, PolicyCard, SignaturePanel } from "@cds/ui/hub/legal";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { signAgreementAction } from "../../../actions/agreement";

export type SigningFormCard = {
  key: string;
  version: number;
  sha256: string;
  title: string;
  metaLine: string;
  summary: string[];
  bodyHtml: string;
  fullTextHref: string;
  whatChanged?: string;
};

export interface SigningFormProps {
  cards: SigningFormCard[];
  stillCurrent: string | null;
  consent: {
    version: number;
    sha256: string;
    metaLine: string;
    bodyHtml: string;
  };
  readOnly: boolean;
  onBehalfOf: string;
  dateLabel: string;
  /** A same-origin /hub path already checked by the page, or null. */
  next: string | null;
  /** Re-accept frame: the shell header is sticky on every width. */
  focused: boolean;
}

const ERR_SIGN =
  "We couldn't record your signature, so nothing was signed. Try again in a minute. If it keeps happening, contact CDS Support.";

function tickId(c: { key: string; sha256: string }): string {
  return `${c.key}#${c.sha256}`;
}

export function SigningForm({
  cards,
  stillCurrent,
  consent,
  readOnly,
  onBehalfOf,
  dateLabel,
  next,
  focused,
}: SigningFormProps) {
  const router = useRouter();
  const [ticks, setTicks] = useState<ReadonlySet<string>>(new Set());
  // The consent tick belongs to one consent version (a new one must be ticked again).
  const [consentTick, setConsentTick] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const [panelInView, setPanelInView] = useState(false);
  const boxRefs = useRef(new Map<string, HTMLInputElement>());
  const consentRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const done = cards.filter((c) => ticks.has(tickId(c))).length;
  const consentOk = consentTick === consent.sha256;
  const missingBoxes = cards.length - done + (consentOk ? 0 : 1);

  // Unstick the progress bar once the signature panel is on screen (it would cover the
  // Sign button).
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setPanelInView(entries.some((e) => e.isIntersecting)),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  function setTick(card: SigningFormCard, on: boolean) {
    if (pending) return;
    setTicks((prev) => {
      const nextSet = new Set(prev);
      if (on) nextSet.add(tickId(card));
      else nextSet.delete(tickId(card));
      return nextSet;
    });
  }

  function focusFirstMissing() {
    const first = cards.find((c) => !ticks.has(tickId(c)));
    if (first) {
      boxRefs.current.get(first.key)?.focus();
      return;
    }
    if (!consentOk) consentRef.current?.focus();
  }

  async function sign() {
    if (pending || readOnly) return;
    setPending(true);
    setError(null);
    let keepPending = false;
    try {
      const res = await signAgreementAction({
        policies: cards.map((c) => ({
          key: c.key,
          version: c.version,
          sha256: c.sha256,
        })),
        consent: { version: consent.version, sha256: consent.sha256 },
        signerName: name,
        ...(next ? { next } : {}),
      });
      if (res.ok) {
        keepPending = true;
        const id = encodeURIComponent(res.data.signatureId);
        const qs = next ? `?next=${encodeURIComponent(res.data.next)}` : "";
        router.push(`/hub/agreement/signed/${id}${qs}`);
        return;
      }
      if (res.code === "agreement_stale") {
        // Reload the new versions; changed ticks drop out by sha, the name stays.
        setError(res.message);
        router.refresh();
        return;
      }
      if (res.code === "agreement_already") {
        setError(
          <>
            {res.message}{" "}
            <Link
              href="/hub/agreement"
              className="font-semibold underline underline-offset-2"
            >
              See your signed agreement
            </Link>
          </>,
        );
        return;
      }
      setError(res.message);
    } catch {
      // A thrown action (network drop, a deploy mid-page) must not leave it spinning.
      setError(ERR_SIGN);
    } finally {
      if (!keepPending) setPending(false);
    }
  }

  const stickyTop = focused ? "top-14" : "top-14 lg:top-0";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className={panelInView ? "" : `sticky z-10 ${stickyTop}`}>
          <AcceptProgress done={done} total={cards.length} sticky={false} />
        </div>
        <ol className="flex flex-col gap-4">
          {cards.map((c) => (
            <PolicyCard
              key={tickId(c)}
              policyKey={c.key}
              title={c.title}
              metaLine={c.metaLine}
              summary={c.summary}
              bodyHtml={c.bodyHtml}
              fullTextHref={c.fullTextHref}
              {...(c.whatChanged ? { whatChanged: c.whatChanged } : {})}
              checked={ticks.has(tickId(c))}
              onCheckedChange={(on) => setTick(c, on)}
              readOnly={readOnly}
              disabled={pending}
              checkboxRef={(el) => {
                if (el) boxRefs.current.set(c.key, el);
                else boxRefs.current.delete(c.key);
              }}
            />
          ))}
        </ol>
        {stillCurrent ? (
          <p className="rounded-lg bg-hub-surface-2 p-4 text-sm text-hub-ink">
            {stillCurrent}
          </p>
        ) : null}
      </div>
      <div ref={panelRef}>
        <SignaturePanel
          consent={{
            metaLine: consent.metaLine,
            consentHtml: consent.bodyHtml,
            checked: consentOk,
            onCheckedChange: (on) => {
              if (!pending) setConsentTick(on ? consent.sha256 : null);
            },
            readOnly,
            checkboxRef: consentRef,
          }}
          name={name}
          onNameChange={setName}
          onBehalfOf={onBehalfOf}
          dateLabel={dateLabel}
          missingBoxes={missingBoxes}
          pending={pending}
          readOnly={readOnly}
          error={error ?? undefined}
          onSign={() => void sign()}
          focusFirstMissing={focusFirstMissing}
        />
      </div>
    </div>
  );
}
