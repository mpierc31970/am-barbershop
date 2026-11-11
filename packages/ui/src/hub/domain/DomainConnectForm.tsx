"use client";
// DomainConnectForm (14-30 choice 3; 14-UI-SPEC "S0 · No domain yet"). Heading Connect your
// domain + the Domain explainer, DOM-WHY-NOW, a TextField "Your domain" (inputmode url,
// autocomplete off, spellcheck off, helper DOM-FIELD-HELP) that normalises a pasted
// "https://www.riverabakery.com/" on blur and shows "We'll use riverabakery.com.", the one
// primary Check my domain (pending Checking…), DOM-OWN under it and the Don't have one yet?
// link. Errors render as an InlineAlert error above the field after submit, focus moves to
// it and the field is aria-invalid. A local check (`parseDomainInput`) catches DOM-INVALID /
// DOM-SUBDOMAIN / DOM-RESERVED before the server action; the server's answer is still the
// authority (its message is P14_COPY text). DOM-CF-REGISTRAR adds Ask CDS Support.
import { JARGON, P14_COPY, parseDomainInput } from "@cds/core/dns";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { rethrowControlFlow } from "../action-errors";
import type { HubActionResult } from "../addon-types";
import { Button, buttonClasses } from "../Button";
import { InlineAlert } from "../feedback";
import { TextField } from "../fields";
import { DOMAIN_UI_COPY as C } from "./copy";

export interface DomainConnectFormProps {
  /** The site's preview host; it and its parent are refused as "belongs to CDS". */
  previewHost: string;
  /** Server action: start the check for this (normalised) domain. */
  action(domain: string): Promise<HubActionResult<unknown>>;
  /** Extra CDS/platform hosts refused locally (the server refuses them too). */
  platformHosts?: readonly string[];
  /** How-to "Get a domain" section. */
  getDomainHref?: string;
  /** Prefilled P12 question ticket (DOM-CF-REGISTRAR). */
  askSupportHref?: string;
  /** Called after a successful start (the caller refreshes). */
  onStarted?(domain: string): void;
}

/** Server codes that should offer Ask CDS Support. */
const SUPPORT_CODES = new Set(["DOM-CF-REGISTRAR", "DOM-TAKEN"]);

function hostsFor(previewHost: string, extra: readonly string[]): Set<string> {
  const set = new Set<string>(extra.map((h) => h.toLowerCase()));
  const p = previewHost.trim().toLowerCase();
  if (p) {
    set.add(p);
    const dot = p.indexOf(".");
    if (dot > 0 && p.slice(dot + 1).includes(".")) set.add(p.slice(dot + 1));
  }
  return set;
}

const LOCAL_ERRORS = {
  invalid: P14_COPY.DOM_INVALID,
  subdomain: P14_COPY.DOM_SUBDOMAIN,
  reserved: P14_COPY.DOM_RESERVED,
} as const;

export function DomainConnectForm({
  previewHost,
  action,
  platformHosts = [],
  getDomainHref,
  askSupportHref,
  onStarted,
}: DomainConnectFormProps) {
  const id = useId();
  const headingId = `${id}-h`;
  const alertRef = useRef<HTMLDivElement>(null);
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  const hosts = () => hostsFor(previewHost, platformHosts);

  function onBlur() {
    const r = parseDomainInput(raw, hosts());
    setPreview(r.ok ? r.domain : null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const r = parseDomainInput(raw, hosts());
    if (!r.ok) {
      setPreview(null);
      setError({ message: LOCAL_ERRORS[r.code], code: r.code });
      return;
    }
    setPreview(r.domain);
    setPending(true);
    try {
      const res = await action(r.domain);
      if (res.ok) {
        setError(null);
        onStarted?.(r.domain);
      } else {
        setError({ message: res.message, code: res.code });
      }
    } catch (err) {
      rethrowControlFlow(err);
      setError({ message: P14_COPY.ERR_GENERIC, code: "network" });
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      data-domain-connect=""
      className="flex max-w-[720px] flex-col gap-4 font-hub text-hub-ink"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-xl leading-tight font-semibold">
          {P14_COPY.EMPTY_H}
        </h2>
        <p className="text-sm text-hub-ink-muted">{JARGON.domain}</p>
      </div>
      <p className="max-w-[68ch] text-base">{P14_COPY.DOM_WHY_NOW}</p>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {error ? (
          <div ref={alertRef} tabIndex={-1} className="focus:outline-none">
            <InlineAlert
              tone="error"
              action={
                SUPPORT_CODES.has(error.code) && askSupportHref ? (
                  <a
                    href={askSupportHref}
                    className={buttonClasses("secondary", "sm")}
                  >
                    {P14_COPY.BTN_ASK_SUPPORT}
                  </a>
                ) : undefined
              }
            >
              {error.message}
            </InlineAlert>
          </div>
        ) : null}
        <div className="flex max-w-md flex-col gap-1">
          <TextField
            id={`${id}-domain`}
            name="domain"
            label={C.domainLabel}
            helper={P14_COPY.DOM_FIELD_HELP}
            error={
              error ? (
                // The visible message is the InlineAlert above; the field keeps the
                // danger border, aria-invalid and a described-by to the same words.
                <span className="sr-only">{error.message}</span>
              ) : undefined
            }
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            value={raw}
            onChange={(e) => {
              setRaw(e.currentTarget.value);
              setPreview(null);
            }}
            onBlur={onBlur}
          />
          {preview ? (
            <p className="text-sm text-hub-ink" data-domain-preview="">
              {C.weUse(preview)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-2">
          <Button
            type="submit"
            variant="primary"
            loading={pending}
            loadingLabel={P14_COPY.BTN_CHECKING}
          >
            {P14_COPY.BTN_CHECK_DOMAIN}
          </Button>
          <p className="max-w-[68ch] text-sm text-hub-ink-muted">
            {P14_COPY.DOM_OWN}
          </p>
        </div>
      </form>
      {getDomainHref ? (
        <a
          href={getDomainHref}
          className="self-start rounded text-base text-hub-accent underline underline-offset-2 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
        >
          {C.dontHaveOne}
        </a>
      ) : null}
    </section>
  );
}
