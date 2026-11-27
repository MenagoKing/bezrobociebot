// Tryb deweloperski: serwer (z automatycznym restartem) + Vite (panel z HMR, proxy /api → :8787).
import { spawn } from 'node:child_process';

const win = process.platform === 'win32';
const procs = [
  spawn(process.execPath, ['--watch', 'server/src/index.ts'], { stdio: 'inherit' }),
  spawn(win ? 'npm.cmd' : 'npm', ['run', 'dev', '-w', 'web'], { stdio: 'inherit', shell: win }),
];
const stop = () => {
  procs.forEach((p) => p.kill());
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => code && stop()));
