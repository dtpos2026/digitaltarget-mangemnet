// Zips chrome-extension/ into public/downloads/dt-whatsapp-extension.zip so the
// portal can offer it as a download (WhatsApp tab → setup card).
// Runs automatically before `npm run build`.
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

// fileURLToPath: works on Windows paths with spaces / drive letters (E:\...).
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "chrome-extension");
const out = join(root, "public", "downloads", "dt-whatsapp-extension.zip");

if (!existsSync(src)) {
  console.warn("chrome-extension/ folder nahi mila — extension ZIP skip (build jari hai).");
  process.exit(0);
}

const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "_metadata") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files[`dt-whatsapp-extension/${relative(src, p).split("\\").join("/")}`] = [readFileSync(p), { mtime: new Date("2026-01-01") }];
  }
})(src);

mkdirSync(join(root, "public", "downloads"), { recursive: true });
writeFileSync(out, zipSync(files, { level: 9 }));
console.log(`extension → ${relative(root, out)} (${Object.keys(files).length} files)`);
