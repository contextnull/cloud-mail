import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const secrets = JSON.parse(execFileSync(process.execPath, [wrangler, 'secret', 'list', '--format', 'json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}));
const hasSecret = secrets.some(secret => secret.name === 'jwt_secret');
let needsBootstrap = !hasSecret;
if (hasSecret) {
  const schema = JSON.parse(execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'cloud-mail', '--remote', '--json',
    '--command', "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'"], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
  if (!Array.isArray(schema) || schema.some(batch => batch.success !== true || !Array.isArray(batch.results))) {
    throw new Error('Could not verify the database bootstrap state.');
  }
  // An empty schema cannot have user sessions; recover a failed initial bootstrap.
  needsBootstrap = !schema.some(batch => batch.results.some(row => row.name === 'user'));
}
const secret = needsBootstrap ? randomBytes(48).toString('hex') : undefined;
const temporary = needsBootstrap ? mkdtempSync(join(tmpdir(), 'cloud-mail-')) : undefined;

try {
  const args = [wrangler, 'deploy'];
  if (needsBootstrap) {
    const secretFile = join(temporary, 'secrets.json');
    writeFileSync(secretFile, JSON.stringify({ jwt_secret: secret }), { mode: 0o600 });
    args.push('--secrets-file', secretFile);
  }
  execFileSync(process.execPath, args, { stdio: 'inherit' });
  if (needsBootstrap) {
    let initialized = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const response = await fetch(`https://mail.leopm.top/api/init/${secret}`, {
          signal: AbortSignal.timeout(30000), redirect: 'error',
          headers: { 'User-Agent': 'CloudMail-Deployment/1.0', Accept: 'text/plain' },
        });
        if (response.ok && (await response.text()).trim() === 'success') {
          initialized = true;
          break;
        }
      } catch {
        // Never print the initialization URL: it contains the signing secret.
      }
      await delay(5000);
    }
    if (!initialized) throw new Error('Database initialization did not complete; inspect Cloudflare Worker logs.');
    console.log('Cloud Mail database initialized successfully.');
  } else {
    console.log('Existing signing secret preserved.');
  }
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
