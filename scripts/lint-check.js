// Cross-platform syntax check for all JavaScript files in the project.
// Runs `node --check` (a full parse, no execution) on every .js file under
// src and test so a syntax error anywhere fails CI — not just in server.js.
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOTS = [path.join(__dirname, "..", "src"), path.join(__dirname, "..", "test")];

const isJs = (f) => f.endsWith(".js");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && isJs(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

let failed = 0;
const files = ROOTS.flatMap((r) => (fs.existsSync(r) ? walk(r) : []));
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    failed += 1;
    process.stderr.write(`Syntax error in ${file}:\n${err.stderr || err.message}\n`);
  }
}

if (failed > 0) {
  process.stderr.write(`lint:check failed: ${failed} file(s) with syntax errors\n`);
  process.exit(1);
}
process.stdout.write(`lint:check passed: ${files.length} file(s) OK\n`);
