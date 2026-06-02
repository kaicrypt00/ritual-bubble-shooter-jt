// Vercel Function entry. Forwards every request not matched by a static
// asset in dist/client to the TanStack Start SSR handler emitted at
// dist/server/server.js.
//
// IMPORTANT: Vercel Node API routes use Node's req/res objects. Returning a
// Web Response from the default export leaves the function open until timeout,
// so this file adapts Node req/res <-> Web Request/Response explicitly.
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

export const config = {
  runtime: "nodejs",
  maxDuration: 30,
};

type StartHandler = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let handlerPromise: Promise<StartHandler> | undefined;

async function loadHandler(): Promise<StartHandler> {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      // Resolve absolute path so node ESM import works on Vercel's filesystem.
      const abs = path.resolve(process.cwd(), "dist/server/server.js");
      const mod = (await import(/* @vite-ignore */ abs)) as { default: StartHandler };
      return mod.default;
    })();
  }
  return handlerPromise;
}

function toWebRequest(req: IncomingMessage): Request {
  const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost").split(",")[0];
  const url = new URL(req.url ?? "/", `${proto}://${host}`).toString();
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value !== undefined) headers.set(key, String(value));
  }

  const method = req.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as BodyInit;
    init.duplex = "half";
  }

  return new Request(url, init);
}

async function sendWebResponse(res: ServerResponse, webResponse: Response) {
  res.statusCode = webResponse.status;
  res.statusMessage = webResponse.statusText;
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));

  if (!webResponse.body) {
    res.end();
    return;
  }

  const body = Readable.fromWeb(webResponse.body as import("node:stream/web").ReadableStream);
  await pipeline(body, res);
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const start = await loadHandler();
    const response = await start.fetch(toWebRequest(req), {}, {});
    await sendWebResponse(res, response);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
    }
    res.end("Internal Server Error");
  }
}
