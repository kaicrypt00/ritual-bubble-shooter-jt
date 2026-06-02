// Vercel Function entry. Forwards every request not matched by a static
// asset in dist/client to the TanStack Start SSR handler emitted at
// ../dist/server/server.js.
//
// The SSR bundle's default export is a Web-standard { fetch(request) }
// object. We use the Node.js runtime (not Edge) because the app's server
// functions rely on node:crypto (createHmac, timingSafeEqual, Buffer) for
// score-submission signing — those APIs are not available on Edge.
// @ts-expect-error - resolved at build time from the Vercel build output
import handler from "../dist/server/server.js";

export const config = {
  runtime: "nodejs20.x",
};

export default async function (request: Request): Promise<Response> {
  return handler.fetch(request, {}, {});
}
