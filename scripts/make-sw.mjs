// Runs automatically after `next build` (npm "postbuild"). Writes public/sw.js and public/precache-manifest.json so the
// service worker knows EVERY file of this exact build and can store them all on the phone for offline use.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const STATIC_DIR = ".next/static";
if (!existsSync(STATIC_DIR) || !existsSync(".next/BUILD_ID")) {
  console.error("make-sw: .next build output not found. Run `next build` first.");
  process.exit(1);
}
const build = readFileSync(".next/BUILD_ID", "utf8").trim();

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const assets = walk(STATIC_DIR)
  .filter((p) => !p.endsWith(".map"))
  .map((p) => "/_next/static/" + relative(STATIC_DIR, p).split(sep).map(encodeURIComponent).join("/"));

// Small files from public/ the screens use (icons, logo, manifest). The scanner engine under /tesseract is NOT here: it is
// ~40 MB across engine variants, so the phone loads only the one build it needs (see warmOcrEngine in src/lib/ocr/client.ts).
for (const name of readdirSync("public")) {
  if (/\.(png|ico|webmanifest|svg)$/.test(name)) assets.push("/" + encodeURIComponent(name));
}

// App screens stored after sign-in. Keep in sync with src/lib/offline-ready.ts (SHELL).
const pages = ["/", "/registration", "/registration/new", "/registration/assign", "/attendance", "/distribution", "/distribution/profile", "/queue", "/admin"];

if (existsSync('public/zxing/zxing_reader.wasm')) assets.push('/zxing/zxing_reader.wasm'); // QR decoder (~1 MB)
const unique = [...new Set(assets)];
const withManifest = [...unique, "/precache-manifest.json"]; // also stored, so readiness can be checked offline
const sw = readFileSync("scripts/sw-template.js", "utf8")
  .replace("__BUILD_ID__", build)
  .replace("__ASSETS__", JSON.stringify(withManifest, null, 1))
  .replace("__PAGES__", JSON.stringify(pages));
writeFileSync("public/sw.js", sw);
writeFileSync("public/precache-manifest.json", JSON.stringify({ build, assets: unique, pages }));
console.log(`make-sw: build ${build}, ${unique.length} files to store offline, ${pages.length} screens`);
