// P10 payments: a recording Stripe HTTP client for tests (BILL-07 proof, assumption A5).
// Never touches the network.
//
// A5 verified against stripe@23.0.0: StripeConfig.httpClient takes an HttpClientInterface
// ({ getClientName, makeRequest(host, port, path, method, headers, requestData, protocol,
// timeout) }) whose response implements { getStatusCode, getHeaders, getRawResponse,
// toStream, toJSON }. For v1 calls `path` carries the query string (GET/DELETE) and
// `requestData` is the form-encoded body (POST). Headers include Idempotency-Key and
// Stripe-Account when request options set them.
import type Stripe from "stripe";

export type RecordedRequest = {
  method: string;
  /** Path without the query string, e.g. `/v1/checkout/sessions`. */
  path: string;
  /** Raw query string (no `?`), "" when none. */
  query: string;
  /** Raw form-encoded body, "" when none. */
  body: string;
  /** Decoded body params (bracket keys kept as sent, e.g. `automatic_tax[enabled]`). */
  form: URLSearchParams;
  /** Decoded query params. */
  search: URLSearchParams;
  idempotencyKey: string | null;
  stripeAccount: string | null;
};

export type FixtureReply = { status: number; body: unknown };

/**
 * A fixture: a JSON body (status 200), a `{ status, body }` reply, or a function of the
 * request returning either. Keys are `"METHOD /v1/path"`; a `*` segment matches any one
 * path segment (e.g. `"GET /v1/subscriptions/*"`).
 */
export type Fixture =
  | FixtureReply
  | Record<string, unknown>
  | ((req: RecordedRequest) => FixtureReply | Record<string, unknown>);

export type RecordingHttp = {
  httpClient: Stripe.HttpClient;
  requests: RecordedRequest[];
  /** Requests whose method + path match `"METHOD /v1/path"` (with `*` segments). */
  find(route: string): RecordedRequest[];
};

function isReply(v: unknown): v is FixtureReply {
  return (
    typeof v === "object" &&
    v !== null &&
    "status" in v &&
    "body" in v &&
    typeof (v as { status: unknown }).status === "number" &&
    Object.keys(v).length === 2
  );
}

function routeMatches(route: string, method: string, path: string): boolean {
  const space = route.indexOf(" ");
  if (space < 0) return false;
  if (route.slice(0, space).toUpperCase() !== method.toUpperCase())
    return false;
  const want = route.slice(space + 1).split("/");
  const got = path.split("/");
  if (want.length !== got.length) return false;
  return want.every((seg, i) => seg === "*" || seg === got[i]);
}

function header(
  headers: Record<string, string | number | string[]>,
  name: string,
): string | null {
  const hit = Object.entries(headers).find(
    ([k]) => k.toLowerCase() === name.toLowerCase(),
  );
  if (!hit) return null;
  const v = hit[1];
  return Array.isArray(v) ? (v[0] ?? null) : String(v);
}

function response(status: number, body: unknown): Stripe.HttpClientResponse {
  const text = JSON.stringify(body);
  return {
    getStatusCode: () => status,
    getHeaders: () => ({
      "request-id": "req_test_recorded",
      "stripe-should-retry": "false",
    }),
    // The SDK decorates the raw response with header fields, so it must be an object.
    getRawResponse: () => ({ status, body: text }),
    toStream: () => {
      throw new Error("recording http client does not stream");
    },
    toJSON: () => Promise.resolve(JSON.parse(text) as unknown),
  };
}

/** Records every request and replays fixture JSON by route. Unknown routes answer 404. */
export function createRecordingHttpClient(
  responses: Readonly<Record<string, Fixture>>,
): RecordingHttp {
  const requests: RecordedRequest[] = [];
  const routes = Object.keys(responses);
  const httpClient: Stripe.HttpClient = {
    getClientName: () => "cds-recording",
    makeRequest: (_host, _port, fullPath, method, headers, requestData) => {
      const q = fullPath.indexOf("?");
      const path = q < 0 ? fullPath : fullPath.slice(0, q);
      const query = q < 0 ? "" : fullPath.slice(q + 1);
      const body = requestData ?? "";
      const req: RecordedRequest = {
        method: method.toUpperCase(),
        path,
        query,
        body,
        form: new URLSearchParams(body),
        search: new URLSearchParams(query),
        idempotencyKey: header(headers, "Idempotency-Key"),
        stripeAccount: header(headers, "Stripe-Account"),
      };
      requests.push(req);
      const route = routes.find((r) => routeMatches(r, req.method, path));
      if (!route) {
        return Promise.resolve(
          response(404, {
            error: {
              type: "invalid_request_error",
              message: `No fixture for ${req.method} ${path}`,
            },
          }),
        );
      }
      const fixture = responses[route];
      const value = typeof fixture === "function" ? fixture(req) : fixture;
      const reply = isReply(value) ? value : { status: 200, body: value };
      return Promise.resolve(response(reply.status, reply.body));
    },
  };
  return {
    httpClient,
    requests,
    find: (route) =>
      requests.filter((r) => routeMatches(route, r.method, r.path)),
  };
}
