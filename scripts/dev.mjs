/**
 * Development launcher — runs the API (tsx watch) and Vite dev server
 * together, forwarding both logs with a prefix. No extra dependencies.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const targets = [
  { name: 'server', color: '\x1b[36m', command: 'npx', args: ['tsx', 'watch', 'src/server/index.ts'] },
  { name: 'client', color: '\x1b[35m', command: 'npx', args: ['vite'] },
];

const children = [];
let shuttingDown = false;

function prefix(name, color, chunk) {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length > 0) {
      process.stdout.write(`${color}[${name}]\x1b[0m ${line}\n`);
    }
  }
}

for (const target of targets) {
  const child = spawn(target.command, target.args, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  child.stdout.on('data', (chunk) => prefix(target.name, target.color, chunk));
  child.stderr.on('data', (chunk) => prefix(target.name, target.color, chunk));
  child.on('exit', (code) => {
    if (!shuttingDown) {
      process.stderr.write(`[${target.name}] exited with code ${code} — stopping dev servers\n`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
