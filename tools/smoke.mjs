// Launches the desktop app hidden for a few seconds and fails if the page
// logged errors or never finished booting. Usage: npm run smoke [exe]
// With an exe path it tests a packaged build (incl. the update check).
import { spawn } from 'child_process';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const exe = process.argv[2] || require('electron');
const args = process.argv[2] ? [] : [path.resolve('.')];
const ms = +(process.env.SMOKE_MS || 15000);

const p = spawn(exe, args, { env: { ...process.env, SF_SMOKE_TEST: String(ms) }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
p.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
p.stderr.on('data', (d) => { out += d; });
p.on('exit', (code) => {
  const errors = out.split('\n').filter((l) => /\[renderer:(error|3)\]/.test(l) || /Uncaught/.test(l));
  const booted = /\[renderer:[^\]]+\] SEEDFINDER_READY/.test(out);
  console.log(`\nexit ${code}; booted: ${booted}; renderer errors: ${errors.length}`);
  for (const e of errors) console.log('  ' + e);
  process.exit(booted && !errors.length ? 0 : 1);
});
