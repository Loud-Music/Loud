import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const folder = resolve("src-tauri/target/release/bundle/nsis");
const installer = readdirSync(folder).find(
  (name) => name.endsWith(".exe") && name.includes(version),
);
if (!installer) throw new Error("Installer is missing");
const signature = readFileSync(
  resolve(folder, `${installer}.sig`),
  "utf8",
).trim();
if (!signature) throw new Error("Installer signature is missing");
writeFileSync(
  resolve(folder, "latest.json"),
  JSON.stringify(
    {
      version,
      notes: "Gapless playback and signed updates.",
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature,
          url: `https://github.com/Loud-Music/app/releases/download/v${version}/${encodeURIComponent(installer)}`,
        },
      },
    },
    null,
    2,
  ) + "\n",
);
