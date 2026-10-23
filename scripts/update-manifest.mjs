import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const folder = resolve("src-tauri/target/release/bundle/nsis");
const installers = readdirSync(folder).filter(
  (name) => name.endsWith("_x64-setup.exe") && name.includes(`_${version}_`),
);
if (installers.length !== 1)
  throw new Error("Expected one Windows x64 installer");
const [installer] = installers;
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
      notes:
        "Хотфикс 0.2.7.1: исправлено перетаскивание окна за свободную область верхней панели. Исправлен выбор одноимённых профилей артистов, из-за которого в карточках отсутствовали альбомы и песни; добавлено переключение профилей. Исправлена раскладка при первом запуске и подготовке компонентов.",
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature,
          url: `https://github.com/Loud-Music/Loud/releases/download/v${version}/${encodeURIComponent(installer)}`,
        },
      },
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  resolve(folder, "SHA256SUMS.txt"),
  [installer, `${installer}.sig`, "latest.json"]
    .map(
      (name) =>
        `${createHash("sha256")
          .update(readFileSync(resolve(folder, name)))
          .digest("hex")}  ${name}\n`,
    )
    .join(""),
);
