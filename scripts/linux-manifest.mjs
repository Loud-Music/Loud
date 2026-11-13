import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const folder = resolve("src-tauri/target/release/bundle/appimage");
const images = readdirSync(folder).filter((name) => name.endsWith(".AppImage"));
if (images.length !== 1) throw new Error("Expected one AppImage");
const [image] = images;
const debFolder = resolve("src-tauri/target/release/bundle/deb");
const debs = readdirSync(debFolder).filter((name) => name.endsWith(".deb"));
if (debs.length !== 1) throw new Error("Expected one deb package");
const [deb] = debs;
const debSignature = readFileSync(
  resolve(debFolder, `${deb}.sig`),
  "utf8",
).trim();
if (!debSignature) throw new Error("Deb signature is missing");
const signature = readFileSync(resolve(folder, `${image}.sig`), "utf8").trim();
if (!signature) throw new Error("AppImage signature is missing");
const manifestPath = resolve(".release/linux/latest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.version !== version) throw new Error("Release version mismatch");
manifest.platforms["linux-x86_64"] = {
  signature,
  url: `https://github.com/Loud-Music/Loud/releases/download/v${version}/${encodeURIComponent(image)}`,
};
manifest.platforms["linux-x86_64-appimage"] =
  manifest.platforms["linux-x86_64"];
manifest.platforms["linux-x86_64-deb"] = {
  signature: debSignature,
  url: `https://github.com/Loud-Music/Loud/releases/download/v${version}/${encodeURIComponent(deb)}`,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const files = [
  resolve(debFolder, deb),
  resolve(debFolder, `${deb}.sig`),
  resolve(folder, image),
  resolve(folder, `${image}.sig`),
  resolve(`.release/linux/Loud-${version}-linux-source.tar.gz`),
];
writeFileSync(
  resolve(".release/linux/SHA256SUMS-linux.txt"),
  files
    .map(
      (file) =>
        `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${basename(file)}\n`,
    )
    .join(""),
);
const checksumPath = resolve(".release/linux/SHA256SUMS.txt");
const hashes = new Map();
for (const line of [
  readFileSync(checksumPath, "utf8"),
  readFileSync(resolve(".release/linux/SHA256SUMS-linux.txt"), "utf8"),
]
  .join("\n")
  .split("\n")) {
  const entry = line.match(/^([a-f0-9]{64})  (.+)$/);
  if (entry) hashes.set(entry[2], entry[1]);
}
hashes.set(
  "latest.json",
  createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
);
writeFileSync(
  checksumPath,
  [...hashes].map(([name, hash]) => `${hash}  ${name}\n`).join(""),
);
