#!/usr/bin/env node
// Regenerates the GENERATED blocks in firestore.rules and storage.rules from
// src/lib/permission-presets.json so the client and the rules never drift.
//   node scripts/generate-rules.mjs          write files
//   node scripts/generate-rules.mjs --check  exit 1 if files are out of date
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(root, "src/lib/permission-presets.json"), "utf8"));

const list = (arr) => `[${arr.map((s) => JSON.stringify(s)).join(", ")}]`;
const mapOfLists = (obj, indent) =>
  "{\n" +
  Object.entries(obj)
    .map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${list(v)}`)
    .join(",\n") +
  `\n${indent}}`;

function block(indent, withCollections) {
  const lines = [
    `function superRoles() { return ${list(data.superRoles)}; }`,
    `function allPermissions() { return ${list(data.permissions.map((p) => p.key))}; }`,
    `function presets() { return ${mapOfLists(data.presets, indent)}; }`,
  ];
  if (withCollections) {
    lines.push(`function readPerms(col) { return ${mapOfLists(data.collectionRead, indent)}.get(col, []); }`);
    lines.push(`function writePerms(col) { return ${mapOfLists(data.collectionWrite, indent)}.get(col, []); }`);
  }
  return lines.map((l) => indent + l).join("\n");
}

function render(file, withCollections) {
  const path = join(root, file);
  const src = readFileSync(path, "utf8");
  const re = /^([ \t]*)\/\/ GENERATED:BEGIN\n[\s\S]*?^[ \t]*\/\/ GENERATED:END/m;
  const m = src.match(re);
  if (!m) throw new Error(`GENERATED markers missing in ${file}`);
  const indent = m[1];
  const next = src.replace(re, `${indent}// GENERATED:BEGIN\n${block(indent, withCollections)}\n${indent}// GENERATED:END`);
  return { path, src, next };
}

const check = process.argv.includes("--check");
let stale = false;
for (const [file, withCollections] of [["firestore.rules", true], ["storage.rules", false]]) {
  const { path, src, next } = render(file, withCollections);
  if (src === next) continue;
  if (check) {
    console.error(`${file} is out of date — run: npm run rules:generate`);
    stale = true;
  } else {
    writeFileSync(path, next);
    console.log(`updated ${file}`);
  }
}
process.exit(stale ? 1 : 0);
