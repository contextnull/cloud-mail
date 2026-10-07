import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('../../mail-vue/', import.meta.url));
const options = { cwd: frontend, stdio: 'inherit' };
execFileSync('pnpm', ['install', '--frozen-lockfile'], options);
execFileSync('pnpm', ['run', 'build'], options);
