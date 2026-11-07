// claude.ai wraps an artifact in its own <html>/<head>/<body>: keep only what goes inside them.
import { readFileSync, writeFileSync } from "node:fs";
const file = "dist-artifact/index.html";
const html = readFileSync(file, "utf8")
  .replace(/<!doctype html>\s*/i, "")
  .replace(/<\/?html[^>]*>\s*/gi, "")
  .replace(/<\/?head>\s*/gi, "")
  .replace(/<\/?body>\s*/gi, "")
  .replace(/<meta charset[^>]*>\s*/i, "")
  .replace(/<meta name="viewport"[^>]*>\s*/i, "");
writeFileSync(file, html);
console.log(`${file}: ${(html.length / 1024).toFixed(1)} kB, page content only`);
