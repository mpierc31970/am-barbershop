// 15-25 (HUB-04, D62): the real Coolify adapter, against a fake fetch. No network.
// Proves the Bearer header, the 405 GET retry on stop/start, the setDomains body, the token
// quote stripping and that an error never carries the token or a response body.
import { describe, expect, it } from "vitest";
import {
  COOLIFY_BASE_URL,
  COOLIFY_TUNNEL_COMMAND,
  CoolifyError,
  CoolifyInsecureUrl,
  CoolifyValuesHidden,
  coolifyApi,
  isSecureCoolifyUrl,
  parseCoolifyToken,
  readCoolifyToken,
} from "./coolify";

const TOKEN = "tok-SECRET-123|abc";

type Call = { method: string; url: string; headers: Headers; body: string };

function fakeFetch(
  answer: (c: Call) => { status: number; json?: unknown; text?: string },
) {
  const calls: Call[] = [];
  const fn = async (input: string | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    const a = answer(call);
    const text = a.text ?? (a.json === undefined ? "" : JSON.stringify(a.json));
    return new Response(text, {
      status: a.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fn: fn as typeof fetch, calls };
}

const BASE = "https://coolify.test/api/v1";

describe("coolifyApi", () => {
  it("WR-B05: defaults to the SSH tunnel on loopback, never plain http to the VPS", () => {
    expect(COOLIFY_BASE_URL).toBe("http://127.0.0.1:8000/api/v1");
    expect(COOLIFY_TUNNEL_COMMAND).toContain("-L 8000:127.0.0.1:8000");
    expect(isSecureCoolifyUrl(COOLIFY_BASE_URL)).toBe(true);
    expect(isSecureCoolifyUrl("http://localhost:8000/api/v1")).toBe(true);
    expect(isSecureCoolifyUrl("http://[::1]:8000/api/v1")).toBe(true);
    expect(isSecureCoolifyUrl("https://coolify.example/api/v1")).toBe(true);
    expect(isSecureCoolifyUrl("http://82.180.132.176:8000/api/v1")).toBe(false);
    expect(isSecureCoolifyUrl("http://127.0.0.1.evil.example/api")).toBe(false);
    expect(isSecureCoolifyUrl("not a url")).toBe(false);
  });

  it("WR-B05: refuses a non-loopback http base before any call, unless opted in", async () => {
    const f = fakeFetch(() => ({ status: 200, json: {} }));
    const insecure = "http://82.180.132.176:8000/api/v1";
    expect(() =>
      coolifyApi({ baseUrl: insecure, token: TOKEN, fetch: f.fn }),
    ).toThrow(CoolifyInsecureUrl);
    expect(f.calls).toEqual([]);
    const err = (() => {
      try {
        coolifyApi({ baseUrl: insecure, token: TOKEN, fetch: f.fn });
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(err?.message).not.toContain(TOKEN);
    const api = coolifyApi({
      baseUrl: insecure,
      token: TOKEN,
      fetch: f.fn,
      allowInsecureHttp: true,
    });
    await api.stop("u1");
    expect(f.calls[0]!.url).toBe(`${insecure}/applications/u1/stop`);
  });

  it("sends the Bearer token and maps an application", async () => {
    const f = fakeFetch(() => ({
      status: 200,
      json: {
        uuid: "u1",
        fqdn: "https://a.example",
        status: "running:healthy",
        git_repository: "mpierc31970/cds-website",
        git_branch: "main",
        build_pack: "dockerfile",
        ports_exposes: 3000,
        dockerfile_location: "/Dockerfile",
        health_check_path: "/api/health",
        secret_field: "never-copied",
      },
    }));
    const api = coolifyApi({ baseUrl: BASE, token: TOKEN, fetch: f.fn });
    const app = await api.getApp("u1");
    expect(f.calls[0]!.url).toBe(`${BASE}/applications/u1`);
    expect(f.calls[0]!.method).toBe("GET");
    expect(f.calls[0]!.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(f.calls[0]!.headers.get("accept")).toBe("application/json");
    expect(app).toEqual({
      uuid: "u1",
      fqdn: "https://a.example",
      status: "running:healthy",
      git_repository: "mpierc31970/cds-website",
      git_branch: "main",
      build_pack: "dockerfile",
      ports_exposes: "3000",
      dockerfile_location: "/Dockerfile",
      health_check_path: "/api/health",
    });
  });

  it("maps env rows (both build-time spellings) and encodes the uuid", async () => {
    const f = fakeFetch(() => ({
      status: 200,
      json: [
        { key: "A", value: "1", is_preview: false, is_buildtime: true },
        { key: "B", value: "2", is_preview: true, is_build_time: false },
        { key: "C", real_value: "3", is_preview: false, is_build_time: true },
      ],
    }));
    const api = coolifyApi({ baseUrl: BASE, token: TOKEN, fetch: f.fn });
    const envs = await api.listEnvKeys("u/1");
    expect(f.calls[0]!.url).toBe(`${BASE}/applications/u%2F1/envs`);
    expect(envs).toEqual([
      { key: "A", value: "1", is_preview: false, is_buildtime: true },
      { key: "B", value: "2", is_preview: true, is_buildtime: false },
      { key: "C", value: "3", is_preview: false, is_buildtime: true },
    ]);
  });

  it("env rows without a value field (token lacks read:sensitive) are refused, never read as missing", async () => {
    const f = fakeFetch(() => ({
      status: 200,
      json: [
        { key: "CDS_ENV", is_preview: false, is_buildtime: false },
        { key: "PB_URL", value: "x", is_preview: false, is_buildtime: false },
      ],
    }));
    const api = coolifyApi({ baseUrl: BASE, token: TOKEN, fetch: f.fn });
    const err = await api.listEnvKeys("u1").catch((e) => e);
    expect(err).toBeInstanceOf(CoolifyValuesHidden);
    expect((err as Error).constructor.name).toBe("CoolifyValuesHidden");
  });

  it("setDomains PATCHes { domains } only", async () => {
    const f = fakeFetch(() => ({ status: 200, json: { uuid: "u1" } }));
    const api = coolifyApi({ baseUrl: BASE, token: TOKEN, fetch: f.fn });
    await api.setDomains("u1", "https://a.example,https://www.a.example");
    expect(f.calls[0]!.method).toBe("PATCH");
    expect(f.calls[0]!.url).toBe(`${BASE}/applications/u1`);
    expect(f.calls[0]!.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(f.calls[0]!.body)).toEqual({
      domains: "https://a.example,https://www.a.example",
    });
  });

  it("deploy returns the deployment id; 405 falls back to GET", async () => {
    const f = fakeFetch((c) =>
      c.method === "POST"
        ? { status: 405 }
        : {
            status: 200,
            json: { deployments: [{ deployment_uuid: "d-9", message: "x" }] },
          },
    );
    const api = coolifyApi({ baseUrl: BASE, token: TOKEN, fetch: f.fn });
    expect(await api.deploy("u1", false)).toBe("d-9");
    expect(f.calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    expect(f.calls[1]!.url).toBe(`${BASE}/deploy?uuid=u1&force=false`);
  });

  it("deploymentStatus GETs /deployments/{id} and returns its status (WR-B02)", async () => {
    const f = fakeFetch(() => ({
      status: 200,
      json: { deployment_uuid: "d 9", status: "in_progress", logs: "x" },
    }));
    const api = coolifyApi({ baseUrl: BASE, token: TOKEN, fetch: f.fn });
    expect(await api.deploymentStatus("d 9")).toBe("in_progress");
    expect(f.calls[0]!.method).toBe("GET");
    expect(f.calls[0]!.url).toBe(`${BASE}/deployments/d%209`);
  });

  it("stop and start POST, then GET on 405", async () => {
    const f = fakeFetch((c) =>
      c.method === "POST" && c.url.endsWith("/stop")
        ? { status: 405 }
        : { status: 200, json: { message: "ok" } },
    );
    const api = coolifyApi({ baseUrl: BASE, token: TOKEN, fetch: f.fn });
    await api.stop("u1");
    await api.start("u1");
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${BASE}/applications/u1/stop`,
      `GET ${BASE}/applications/u1/stop`,
      `POST ${BASE}/applications/u1/start`,
    ]);
  });

  it("a non-2xx is a CoolifyError with status + endpoint only, never the token or body", async () => {
    const f = fakeFetch(() => ({
      status: 409,
      text: `{"message":"conflict","echo":"${TOKEN}","value":"SECRET-ENV"}`,
    }));
    const api = coolifyApi({ baseUrl: BASE, token: TOKEN, fetch: f.fn });
    const err = await api.setDomains("u1", "https://a.example").catch((e) => e);
    expect(err).toBeInstanceOf(CoolifyError);
    expect((err as CoolifyError).status).toBe(409);
    expect((err as CoolifyError).endpoint).toBe("setDomains");
    const shown = `${String(err)} ${(err as Error).stack ?? ""} ${JSON.stringify(err)}`;
    expect(shown).not.toContain(TOKEN);
    expect(shown).not.toContain("SECRET-ENV");
  });

  it("a network failure is a CoolifyError with status 0 and no token", async () => {
    const fn = (async () => {
      throw new TypeError(`fetch failed for ${TOKEN}`);
    }) as unknown as typeof fetch;
    const api = coolifyApi({ baseUrl: BASE, token: TOKEN, fetch: fn });
    const err = await api.getApp("u1").catch((e) => e);
    expect(err).toBeInstanceOf(CoolifyError);
    expect((err as CoolifyError).status).toBe(0);
    expect(String(err)).not.toContain(TOKEN);
  });

  it("refuses an empty token", () => {
    expect(() => coolifyApi({ baseUrl: BASE, token: "  " })).toThrow();
  });
});

describe("Coolify token", () => {
  it("strips whitespace and surrounding quotes", () => {
    expect(parseCoolifyToken("  'abc|def'\n")).toBe("abc|def");
    expect(parseCoolifyToken('"abc"')).toBe("abc");
    expect(parseCoolifyToken("abc\r\n")).toBe("abc");
    expect(parseCoolifyToken("''")).toBeNull();
    expect(parseCoolifyToken("")).toBeNull();
  });

  it("reads ~/.coolify_api_token first, then .env.local COOLIFY_API_TOKEN", () => {
    const files: Record<string, string> = {
      "/home/.coolify_api_token": "'from-home'\n",
      "/repo/.env.local": "PB_URL=x\nCOOLIFY_API_TOKEN='from-env'\nOTHER=y\n",
    };
    const readFile = (p: string) => {
      const v = files[p.replace(/\\/g, "/")];
      if (v === undefined) throw new Error("ENOENT");
      return v;
    };
    expect(readCoolifyToken({ home: "/home", cwd: "/repo", readFile })).toBe(
      "from-home",
    );
    delete files["/home/.coolify_api_token"];
    expect(readCoolifyToken({ home: "/home", cwd: "/repo", readFile })).toBe(
      "from-env",
    );
    delete files["/repo/.env.local"];
    expect(readCoolifyToken({ home: "/home", cwd: "/repo", readFile })).toBe(
      null,
    );
  });

  it("handles export prefix and double quotes in .env.local", () => {
    const readFile = (p: string) => {
      if (p.replace(/\\/g, "/") === "/repo/.env.local")
        return 'export COOLIFY_API_TOKEN="q-tok"\n';
      throw new Error("ENOENT");
    };
    expect(readCoolifyToken({ home: "/home", cwd: "/repo", readFile })).toBe(
      "q-tok",
    );
  });
});
