// Builds the Windows installer and publishes it as a GitHub Release, which is
// what installed copies of Seed Finder check on startup.
//
//   1. bump "version" in package.json (e.g. 1.0.1) and commit
//   2. npm run release            (needs the GitHub CLI, logged in)
//
// Pass --skip-build to upload an existing build in release/.
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tag = 'v' + pkg.version;
const sh = (cmd) => execSync(cmd, { stdio: 'inherit' });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

if (out('git status --porcelain')) {
  console.error('Commit your changes first (the release is tagged from HEAD).');
  process.exit(1);
}
try { out(`gh release view ${tag}`); console.error(`${tag} already exists. Bump "version" in package.json.`); process.exit(1); } catch { /* not released yet */ }

if (!process.argv.includes('--skip-build')) sh('npx electron-builder --win --publish never');

const dir = 'release';
const exe = `Seed-Finder-Setup-${pkg.version}.exe`;
const files = [exe, `${exe}.blockmap`, 'latest.yml'].map((f) => path.join(dir, f));
for (const f of files) if (!fs.existsSync(f)) { console.error('missing build output: ' + f); process.exit(1); }

sh('git push');
sh(`git tag ${tag}`);
sh(`git push origin ${tag}`);
sh(`gh release create ${tag} ${files.map((f) => `"${f}"`).join(' ')} --title "Seed Finder ${pkg.version}" --generate-notes`);
console.log(`\nPublished ${tag}. Installed copies will pick it up the next time they start.`);
