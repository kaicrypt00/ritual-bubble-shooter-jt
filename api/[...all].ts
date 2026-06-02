// Vercel Function entry. Forwards every request not matched by a static
// asset in dist/client to the TanStack Start SSR handler emitted at
// dist/server/server.js.
//
// We load the bundle at request time via createRequire so Vercel's esbuild
// step does NOT try to inline it. The full dist/server tree is shipped with
// the function via vercel.json -> functions.includeFiles.
import { createRequire } from "node:module";
import path from "node:path";

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
      const require = createRequire(import.meta.url);
      // Resolve absolute path so node ESM import works on Vercel's filesystem.
      const abs = path.resolve(process.cwd(), "dist/server/server.js");
      const mod = (await import(/* @vite-ignore */ abs)) as { default: StartHandler };
      return mod.default;
    })();
  }
  return handlerPromise;
}

export default async function handler(request: Request): Promise<Response> {
  const start = await loadHandler();
  return start.fetch(request, {}, {});
}
