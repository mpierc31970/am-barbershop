// File scanners for form uploads (CONT-20, D234, D255; CONTEXT A3-Q3; T-07-15-11; 07-15).
//
// Fail closed: the default unavailableScanner answers "error" for everything, so upload fields
// stay hidden (forms still submit). clamdScanner speaks ClamAV's INSTREAM protocol over TCP:
// `zINSTREAM\0`, then each chunk as a 4-byte big-endian length + bytes (at most 64 KiB), then a
// zero-length terminator; the reply ends with `\0`. Every failure (connect error, timeout,
// closed socket, oversize input, an unknown reply) resolves "error"; nothing throws. The
// upload UI itself ships with Forms Pro (BILL-14). ClamAV is free and reached over node:net:
// no package is added.
import { createConnection, type Socket } from "node:net";
import { FORM_UPLOAD_MAX_BYTES } from "../storage/keys";
import type { FileScanVerdict, FileScanner } from "./scanner-port";

const CHUNK = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const PING_TIMEOUT_MS = 3_000;
const MAX_REPLY = 4096;

export const unavailableScanner: FileScanner = Object.freeze({
  name: "unavailable" as const,
  scan(): Promise<FileScanVerdict> {
    return Promise.resolve("error");
  },
});

export type ClamdOptions = {
  host: string;
  port: number;
  timeoutMs?: number;
  maxBytes?: number;
};

/** "stream: OK" -> clean, "stream: <name> FOUND" -> infected, anything else -> error. */
function verdictOf(reply: string): FileScanVerdict {
  const text = reply.replace(/\0/g, "").trim();
  if (/ERROR$/.test(text)) return "error";
  if (/^stream: OK$/.test(text)) return "clean";
  if (/^stream: .+ FOUND$/.test(text)) return "infected";
  return "error";
}

function waitDrain(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      socket.off("drain", done);
      socket.off("close", done);
      resolve();
    };
    socket.once("drain", done);
    socket.once("close", done);
  });
}

export function createClamdScanner(opts: ClamdOptions): FileScanner {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? FORM_UPLOAD_MAX_BYTES;
  return Object.freeze({
    name: "clamd" as const,
    scan(input: AsyncIterable<Uint8Array>): Promise<FileScanVerdict> {
      return new Promise<FileScanVerdict>((resolve) => {
        let finished = false;
        let reply = "";
        const socket = createConnection({ host: opts.host, port: opts.port });
        const timer = setTimeout(() => finish("error"), timeoutMs);
        function finish(v: FileScanVerdict): void {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(v);
        }
        socket.on("error", () => finish("error"));
        socket.on("close", () =>
          finish(reply === "" ? "error" : verdictOf(reply)),
        );
        socket.on("data", (d: Buffer) => {
          reply += d.toString("latin1");
          if (reply.includes("\0")) finish(verdictOf(reply));
          else if (reply.length > MAX_REPLY) finish("error");
        });
        socket.on("connect", () => {
          void (async () => {
            try {
              socket.write("zINSTREAM\0");
              let total = 0;
              for await (const chunk of input) {
                if (finished) return;
                total += chunk.byteLength;
                if (total > maxBytes) return finish("error");
                for (let off = 0; off < chunk.byteLength; off += CHUNK) {
                  const part = chunk.subarray(off, off + CHUNK);
                  const len = Buffer.alloc(4);
                  len.writeUInt32BE(part.byteLength, 0);
                  const ok = socket.write(Buffer.concat([len, part]));
                  if (finished) return;
                  if (!ok) await waitDrain(socket);
                }
              }
              if (!finished) socket.write(Buffer.alloc(4));
            } catch {
              finish("error");
            }
          })();
        });
      });
    },
  });
}

/** True when clamd answers PONG within the timeout. */
export function clamdPing(opts: {
  host: string;
  port: number;
  timeoutMs?: number;
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let finished = false;
    let reply = "";
    const socket = createConnection({ host: opts.host, port: opts.port });
    const timer = setTimeout(
      () => finish(false),
      opts.timeoutMs ?? PING_TIMEOUT_MS,
    );
    function finish(v: boolean): void {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(v);
    }
    socket.on("error", () => finish(false));
    socket.on("close", () =>
      finish(reply.replace(/\0/g, "").trim() === "PONG"),
    );
    socket.on("data", (d: Buffer) => {
      reply += d.toString("latin1");
      if (reply.includes("\0") || reply.length > MAX_REPLY) {
        finish(reply.replace(/\0/g, "").trim() === "PONG");
      }
    });
    socket.on("connect", () => socket.write("zPING\0"));
  });
}

/** clamd's address from CLAMD_HOST / CLAMD_PORT; throws when either is missing or bad. */
export function clamdAddress(): { host: string; port: number } {
  const host = process.env.CLAMD_HOST ?? "";
  const rawPort = process.env.CLAMD_PORT ?? "";
  const port = /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : NaN;
  if (host === "" || !(port >= 1 && port <= 65535)) {
    throw new Error(
      'CDS_FILE_SCANNER="clamd" needs CLAMD_HOST and a numeric CLAMD_PORT',
    );
  }
  return { host, port };
}

/** The configured scanner: unset or "unavailable" = the fail-closed stand-in. */
export function getFileScanner(): FileScanner {
  const v = process.env.CDS_FILE_SCANNER;
  if (v === undefined || v === "" || v === "unavailable") {
    return unavailableScanner;
  }
  if (v === "clamd") return createClamdScanner(clamdAddress());
  throw new Error(
    `CDS_FILE_SCANNER="${v}" has no implementation (use "clamd", or unset it for the fail-closed stand-in)`,
  );
}
