// D234, CONTEXT A3-Q3, T-07-15-11 (07-15): fail-closed stand-in and the clamd INSTREAM client
// against a fake node:net server.
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  clamdPing,
  createClamdScanner,
  getFileScanner,
  unavailableScanner,
} from "./scanner";
import { formsStatus } from "./status";

type Fake = { port: number; received: () => Buffer; server: Server };

let servers: Server[] = [];
const envKeys = ["CDS_FILE_SCANNER", "CLAMD_HOST", "CLAMD_PORT"] as const;
const savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));

afterEach(async () => {
  await Promise.all(
    servers.map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
  servers = [];
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** A fake clamd: collects bytes; once the 4-zero terminator arrives, `respond` runs. */
function fakeClamd(
  respond: (socket: Socket, data: Buffer) => void,
  opts: { onConnect?: (socket: Socket) => void } = {},
): Promise<Fake> {
  let received = Buffer.alloc(0);
  const server = createServer((socket) => {
    socket.on("error", () => undefined);
    opts.onConnect?.(socket);
    socket.on("data", (d) => {
      received = Buffer.concat([received, d]);
      const zero = Buffer.alloc(4);
      if (
        received.length >= 14 &&
        received.subarray(received.length - 4).equals(zero)
      ) {
        respond(socket, received);
      } else if (received.toString("latin1") === "zPING\0") {
        respond(socket, received);
      }
    });
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, received: () => received, server });
    });
  });
}

async function* chunks(...parts: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const p of parts) yield p;
}

/** Parse INSTREAM framing: command, then [len][bytes]... then 0000. */
function frames(buf: Buffer): {
  command: string;
  sizes: number[];
  body: Buffer;
} {
  const command = buf.subarray(0, 10).toString("latin1");
  const sizes: number[] = [];
  const parts: Buffer[] = [];
  let off = 10;
  for (;;) {
    const n = buf.readUInt32BE(off);
    off += 4;
    if (n === 0) break;
    sizes.push(n);
    parts.push(buf.subarray(off, off + n));
    off += n;
  }
  return { command, sizes, body: Buffer.concat(parts) };
}

describe("unavailableScanner", () => {
  it("answers error without reading the stream", async () => {
    let read = false;
    async function* never(): AsyncIterable<Uint8Array> {
      read = true;
      yield new Uint8Array(1);
    }
    expect(await unavailableScanner.scan(never())).toBe("error");
    expect(read).toBe(false);
    expect(unavailableScanner.name).toBe("unavailable");
  });
});

describe("createClamdScanner (INSTREAM)", () => {
  it("clean on 'stream: OK', with correct framing split at 64 KiB", async () => {
    const fake = await fakeClamd((s) => s.end("stream: OK\0"));
    const scanner = createClamdScanner({ host: "127.0.0.1", port: fake.port });
    const big = new Uint8Array(70 * 1024).fill(7);
    const small = new Uint8Array([1, 2, 3]);
    expect(await scanner.scan(chunks(big, small))).toBe("clean");
    const f = frames(fake.received());
    expect(f.command).toBe("zINSTREAM\0");
    expect(f.sizes).toEqual([64 * 1024, 6 * 1024, 3]);
    expect(f.body.length).toBe(70 * 1024 + 3);
    expect(scanner.name).toBe("clamd");
  });

  it("infected on FOUND", async () => {
    const fake = await fakeClamd((s) =>
      s.end("stream: Eicar-Test-Signature FOUND\0"),
    );
    const scanner = createClamdScanner({ host: "127.0.0.1", port: fake.port });
    expect(await scanner.scan(chunks(new Uint8Array([1])))).toBe("infected");
  });

  it("error on an ERROR reply, garbage, a closed socket or a timeout", async () => {
    const limit = await fakeClamd((s) =>
      s.end("INSTREAM size limit exceeded. ERROR\0"),
    );
    expect(
      await createClamdScanner({ host: "127.0.0.1", port: limit.port }).scan(
        chunks(new Uint8Array([1])),
      ),
    ).toBe("error");

    const garbage = await fakeClamd((s) => s.end("hello\0"));
    expect(
      await createClamdScanner({ host: "127.0.0.1", port: garbage.port }).scan(
        chunks(new Uint8Array([1])),
      ),
    ).toBe("error");

    const closed = await fakeClamd(() => undefined, {
      onConnect: (s) => s.destroy(),
    });
    expect(
      await createClamdScanner({ host: "127.0.0.1", port: closed.port }).scan(
        chunks(new Uint8Array([1])),
      ),
    ).toBe("error");

    const silent = await fakeClamd(() => undefined);
    expect(
      await createClamdScanner({
        host: "127.0.0.1",
        port: silent.port,
        timeoutMs: 200,
      }).scan(chunks(new Uint8Array([1]))),
    ).toBe("error");
  });

  it("error on a refused connection", async () => {
    const fake = await fakeClamd(() => undefined);
    const port = fake.port;
    await new Promise<void>((r) => fake.server.close(() => r()));
    servers = servers.filter((s) => s !== fake.server);
    expect(
      await createClamdScanner({ host: "127.0.0.1", port }).scan(
        chunks(new Uint8Array([1])),
      ),
    ).toBe("error");
  });

  it("input over maxBytes is error and sends no more", async () => {
    const fake = await fakeClamd((s) => s.end("stream: OK\0"));
    const scanner = createClamdScanner({
      host: "127.0.0.1",
      port: fake.port,
      maxBytes: 10,
    });
    let pulled = 0;
    async function* many(): AsyncIterable<Uint8Array> {
      for (let i = 0; i < 100; i++) {
        pulled += 1;
        yield new Uint8Array(8);
      }
    }
    expect(await scanner.scan(many())).toBe("error");
    expect(pulled).toBeLessThanOrEqual(2);
  });
});

describe("clamdPing", () => {
  it("true on PONG, false otherwise", async () => {
    const pong = await fakeClamd((s) => s.end("PONG\0"));
    expect(await clamdPing({ host: "127.0.0.1", port: pong.port })).toBe(true);
    const nope = await fakeClamd((s) => s.end("NOPE\0"));
    expect(await clamdPing({ host: "127.0.0.1", port: nope.port })).toBe(false);
    const silent = await fakeClamd(() => undefined);
    expect(
      await clamdPing({ host: "127.0.0.1", port: silent.port, timeoutMs: 150 }),
    ).toBe(false);
  });
});

describe("getFileScanner", () => {
  it("unset or 'unavailable' = the stand-in", () => {
    delete process.env.CDS_FILE_SCANNER;
    expect(getFileScanner()).toBe(unavailableScanner);
    process.env.CDS_FILE_SCANNER = "unavailable";
    expect(getFileScanner()).toBe(unavailableScanner);
  });

  it("clamd needs CLAMD_HOST and a numeric CLAMD_PORT", () => {
    process.env.CDS_FILE_SCANNER = "clamd";
    delete process.env.CLAMD_HOST;
    process.env.CLAMD_PORT = "3310";
    expect(() => getFileScanner()).toThrow(/CLAMD_HOST/);
    process.env.CLAMD_HOST = "127.0.0.1";
    process.env.CLAMD_PORT = "abc";
    expect(() => getFileScanner()).toThrow(/CLAMD_PORT/);
    process.env.CLAMD_PORT = "3310";
    expect(getFileScanner().name).toBe("clamd");
  });

  it("any other value throws (never a silent fallback)", () => {
    process.env.CDS_FILE_SCANNER = "virustotal";
    expect(() => getFileScanner()).toThrow(/virustotal/);
  });
});

describe("formsStatus", () => {
  it("stand-in reports off; clamd reports ok or down", async () => {
    expect(await formsStatus({ scanner: unavailableScanner })).toEqual({
      scanner: "unavailable",
      scanner_status: "off",
      notify_failures_24h: 0,
    });
    const clamd = createClamdScanner({ host: "127.0.0.1", port: 1 });
    expect(
      (await formsStatus({ scanner: clamd, ping: () => Promise.resolve(true) }))
        .scanner_status,
    ).toBe("ok");
    expect(
      (
        await formsStatus({
          scanner: clamd,
          ping: () => Promise.reject(new Error("x")),
        })
      ).scanner_status,
    ).toBe("down");
    process.env.CDS_FILE_SCANNER = "bogus";
    expect((await formsStatus()).scanner_status).toBe("down");
  });
});
