"use client";
// Cloudflare Turnstile, explicit render (ONB-08, D213; UI-SPEC "Save your quote card";
// T-06-74, T-06-75). No npm package: the script comes from challenges.cloudflare.com, the
// only third-party origin the platform CSP allows (script-src, frame-src). The widget is
// managed with appearance "interaction-only", so it stays invisible unless Cloudflare wants
// a click, and then shows under the save row. The token is handed to the parent, which
// posts it as `cf-turnstile-response`; the server verifies it (packages/db human-check).
//
// Stand-in (GO-LIVE "Cloudflare (DNS + Turnstile)"): without NEXT_PUBLIC_TURNSTILE_SITE_KEY
// the Cloudflare test key 1x00000000000000000000AA is used; it always passes, and the
// server's test secret accepts it.
import { useEffect, useRef } from "react";

export const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const SCRIPT_ID = "cf-turnstile-script";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      appearance?: "always" | "execute" | "interaction-only";
      "response-field"?: boolean;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function turnstileSiteKey(): string {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return key ? key : TURNSTILE_TEST_SITE_KEY;
}

/** Load the script once; resolve when window.turnstile exists. */
function loadTurnstile(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("load")),
    );
    script.addEventListener("error", () => reject(new Error("load")));
  });
}

export interface TurnstileProps {
  /** A fresh token, or "" when it expired or failed. */
  onToken: (token: string) => void;
  /** Change this to get a new token (tokens are single-use: reset after each submit). */
  resetKey?: unknown;
}

export function Turnstile({ onToken, resetKey }: TurnstileProps) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenCb = useRef(onToken);
  useEffect(() => {
    tokenCb.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let live = true;
    loadTurnstile()
      .then((api) => {
        if (!live || !box.current || widget.current) return;
        widget.current = api.render(box.current, {
          sitekey: turnstileSiteKey(),
          appearance: "interaction-only",
          "response-field": false,
          callback: (t) => tokenCb.current(t),
          "expired-callback": () => tokenCb.current(""),
          "error-callback": () => tokenCb.current(""),
        });
      })
      .catch(() => {
        // The server check fails closed and the card shows ERR-HUMAN.
      });
    return () => {
      live = false;
      if (widget.current && window.turnstile) {
        window.turnstile.remove(widget.current);
      }
      widget.current = null;
    };
  }, []);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (widget.current && window.turnstile) {
      tokenCb.current("");
      window.turnstile.reset(widget.current);
    }
  }, [resetKey]);

  return <div ref={box} className="empty:hidden" />;
}
