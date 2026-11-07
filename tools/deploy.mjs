// Build the site and publish it on GitHub Pages: `npm run deploy`.
// The single-file build (dist/index.html) is pushed as the only file on the gh-pages branch of this
// repository's `origin`, which GitHub Pages serves at https://<user>.github.io/<repo>/.
import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit" });
const origin = execSync("git remote get-url origin").toString().trim();

run("npm run build");
const dir = mkdtempSync(join(tmpdir(), "ollie-pages-"));
try {
  cpSync("dist/index.html", join(dir, "index.html"));
  writeFileSync(join(dir, ".nojekyll"), ""); // serve the file as it is, no Jekyll processing
  run("git init -q -b gh-pages", dir);
  run("git add -A", dir);
  run('git commit -q -m "Deploy Ollie Physics Lab"', dir);
  run(`git push -f "${origin}" gh-pages`, dir);
  const m = origin.match(/github\.com[/:]([^/]+)\/(.+?)(\.git)?$/);
  if (m) console.log(`\nPublished: https://${m[1]}.github.io/${m[2]}/  (free-skate park: add #park)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
