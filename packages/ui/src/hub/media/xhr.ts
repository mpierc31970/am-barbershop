// The one XHR helper for hub uploads (07-17 choice 10; RESEARCH Pitfall 1). Extracted from
// ImageUpload (06-19) so the photo field, the library uploader and the chunked MP4/MP3
// uploader share one request/progress/abort path. XHR (not fetch) because only XHR reports
// upload progress. Never logs URLs, file names or bodies (T-07-17-08).
//
//   startXhr  callback form: the outcome arrives synchronously inside the XHR event, so a
//             component can update state in the same tick (ImageUpload's contract).
//   sendXhr   promise form for sequential flows (chunk parts): resolves { status, json },
//             rejects AbortError on abort and NetworkError on a network failure.

export class AbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

export class NetworkError extends Error {
  constructor() {
    super("network");
    this.name = "NetworkError";
  }
}

export type XhrResult = { status: number; json: Record<string, unknown> };

export type XhrOptions = {
  method: string;
  url: string;
  body?: XMLHttpRequestBodyInit | null;
  headers?: Record<string, string>;
  /** Upload progress in bytes (only when the browser can compute it). */
  onProgress?(loaded: number, total: number): void;
  /** Every byte of the body has left the browser (the server is now working). */
  onUploaded?(): void;
  signal?: AbortSignal;
};

export type XhrOutcome =
  | { ok: true; result: XhrResult }
  | { ok: false; error: AbortError | NetworkError };

function parse(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text || "{}");
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Start one request; `done` is called exactly once. Returns an abort handle. */
export function startXhr(
  opts: XhrOptions,
  done: (outcome: XhrOutcome) => void,
): { abort(): void } {
  let settled = false;
  const finish = (o: XhrOutcome) => {
    if (settled) return;
    settled = true;
    opts.signal?.removeEventListener("abort", onSignal);
    done(o);
  };
  const xhr = new XMLHttpRequest();
  function onSignal() {
    xhr.abort();
    finish({ ok: false, error: new AbortError() });
  }
  if (opts.signal?.aborted) {
    finish({ ok: false, error: new AbortError() });
    return { abort() {} };
  }
  xhr.open(opts.method, opts.url);
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    xhr.setRequestHeader(k, v);
  }
  xhr.upload.onprogress = (e: ProgressEvent) => {
    if (!e.lengthComputable || e.total <= 0) return;
    opts.onProgress?.(e.loaded, e.total);
  };
  xhr.upload.onload = () => {
    opts.onUploaded?.();
  };
  xhr.onload = () => {
    finish({
      ok: true,
      result: { status: xhr.status, json: parse(xhr.responseText) },
    });
  };
  xhr.onerror = () => finish({ ok: false, error: new NetworkError() });
  xhr.onabort = () => finish({ ok: false, error: new AbortError() });
  opts.signal?.addEventListener("abort", onSignal);
  xhr.send(opts.body ?? null);
  return {
    abort() {
      xhr.abort();
      finish({ ok: false, error: new AbortError() });
    },
  };
}

/** Promise form: resolves on any HTTP answer; rejects AbortError / NetworkError. */
export function sendXhr(opts: XhrOptions): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    startXhr(opts, (o) => (o.ok ? resolve(o.result) : reject(o.error)));
  });
}
