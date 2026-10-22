import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { get } from "node:https";
import { catalogOrigins } from "./src/lib/catalogRequest";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "catalog-api",
      configureServer(server) {
        server.middlewares.use("/catalog-api", (request, response) => {
          const match = request.url?.match(
            /^\/(audius|wikimedia|ccmixter|openverse|lrclib|betterlyrics|lyricsplus|amll|lrcmux|itunes|rmmrevival|deezer)(\/.*)$/,
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
          const upstream = get(
            target,
            {
              maxHeaderSize: 1024 * 1024,
              headers: { "User-Agent": "LoudPlatform/0.2" },
            },
            (result) => {
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
        });
      },
    },
  ],
  clearScreen: false,
  server: {
    watch: {
      ignored: [
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
  build: { target: "es2022" },
});
