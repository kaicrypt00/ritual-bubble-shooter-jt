// Vercel-only Vite config. The default vite.config.ts targets Cloudflare
// Workers (used by the Lovable preview). This config disables the Cloudflare
// plugin so the build emits a generic SSR bundle (dist/server/server.js) that
// the Vercel Edge function in api/[...all].ts can import.
//
// Do NOT use this for local Lovable preview — use vite.config.ts there.
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const walletConnectTimeEsm = fileURLToPath(
  new URL("./node_modules/@walletconnect/time/dist/esm/index.js", import.meta.url),
);

export default defineConfig({
  cloudflare: false,
  vite: {
    resolve: {
      alias: [{ find: "@walletconnect/time", replacement: walletConnectTimeEsm }],
    },
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});
