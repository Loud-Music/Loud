import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { get } from "node:https";
import { catalogOrigins } from "./src/lib/catalogRequest";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "catalog-api",
      configureServer(server) {
        server.middlewares.use("/catalog-api", (request, response) => {
          const match = request.url?.match(
            /^\/(loud|audius|wikimedia|ccmixter|openverse|lrclib|betterlyrics|lyricsplus|amll|lrcmux|itunes|appleweb|rmmrevival|deezer)(\/.*)$/,
          );
          if (!match || request.method !== "GET") {
            response.writeHead(404).end();
            return;
          }
          const origin =
            catalogOrigins[match[1] as keyof typeof catalogOrigins];
          const target = new URL(match[2], origin);
          if (target.origin !== origin) {
            response.writeHead(400).end();
            return;
          }
          const forward = (url: URL, remaining = 3) => {
            const upstream = get(
              url,
              {
                maxHeaderSize: 1024 * 1024,
                headers: { "User-Agent": "LoudPlatform/0.2" },
              },
              (result) => {
                if (
                  match[1] === "appleweb" &&
                  [301, 302, 303, 307, 308].includes(result.statusCode || 0) &&
                  result.headers.location
                ) {
                  const next = new URL(result.headers.location, url);
                  result.resume();
                  if (remaining > 0 && next.origin === origin)
                    forward(next, remaining - 1);
                  else response.writeHead(502).end();
                  return;
                }
                if (match[1] === "appleweb") {
                  const chunks: Buffer[] = [];
                  let size = 0;
                  result.on("data", (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > 8 * 1024 * 1024)
                      upstream.destroy(new Error("Catalog response too large"));
                    else chunks.push(chunk);
                  });
                  result.on("end", () => {
                    try {
                      if (result.statusCode !== 200)
                        throw new Error("Apple catalog unavailable");
                      const html = Buffer.concat(chunks).toString();
                      const script = html.match(
                        /<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/,
                      );
                      const page =
                        script && JSON.parse(script[1]).data?.[0]?.data;
                      if (!Array.isArray(page?.sections))
                        throw new Error("Apple catalog page missing");
                      response
                        .writeHead(200, { "Content-Type": "application/json" })
                        .end(JSON.stringify(page));
                    } catch {
                      response.writeHead(502).end();
                    }
                  });
                  return;
                }
                response.writeHead(result.statusCode || 502, {
                  "Content-Type": "application/json",
                });
                let bytes = 0;
                result.on("data", (chunk) => {
                  bytes += chunk.length;
                  if (bytes > 8 * 1024 * 1024)
                    upstream.destroy(new Error("Catalog response too large"));
                });
                result.pipe(response);
              },
            );
            upstream.setTimeout(25000, () =>
              upstream.destroy(new Error("Catalog timed out")),
            );
            upstream.on("error", () => {
              if (!response.headersSent) response.writeHead(502);
              response.end();
            });
            response.on("close", () => upstream.destroy());
          };
          forward(target);
        });
      },
    },
  ],
  clearScreen: false,
  server: {
    watch: {
      ignored: [
        "**/.release/**",
        "**/verification/**",
        "**/test-results/**",
        "**/releases/**",
        "**/screenshots/**",
        "**/src-tauri/**",
      ],
    },
    proxy: {
      "/archive-api": {
        target: "https://archive.org",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/archive-api/, ""),
      },
    },
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    outDir: mode === "distributor" ? ".release/distributor-web" : "dist",
    rollupOptions:
      mode === "distributor" ? { input: "distributor.html" } : undefined,
  },
}));
