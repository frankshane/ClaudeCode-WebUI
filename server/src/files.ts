import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { FileMatch } from '../../shared/protocol.ts';

const run = promisify(execFile);
const CACHE_MS = 30_000;
const MAX_FILES = 50_000;
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.idea',
  '.vscode',
  'coverage',
]);

const cache = new Map<string, { at: number; files: Promise<string[]> }>();

/** Every file under `cwd` (relative, `/`-separated), honoring .gitignore when it's a git repo. */
function listFiles(cwd: string): Promise<string[]> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.files;
  const files = gitFiles(cwd).catch(() => walk(cwd));
  cache.set(cwd, { at: Date.now(), files });
  files.catch(() => cache.delete(cwd));
  return files;
}

async function gitFiles(cwd: string): Promise<string[]> {
  const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 5000,
    windowsHide: true,
  });
  return stdout.split('\0').filter(Boolean).slice(0, MAX_FILES);
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue: Array<[string, number]> = [['', 0]];
  while (queue.length && out.length < MAX_FILES) {
    const [rel, depth] = queue.shift()!;
    const entries = await readdir(join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && depth < 12) queue.push([path, depth + 1]);
      } else if (e.isFile()) {
        out.push(path);
      }
    }
  }
  return out;
}

/** Ranks files and directories for an `@` mention query. */
export async function matchFiles(cwd: string, query: string, limit = 30): Promise<FileMatch[]> {
  const files = await listFiles(cwd);
  const q = query.toLowerCase().replace(/\\/g, '/');

  const dirs = new Set<string>();
  for (const f of files) {
    for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i + 1));
  }
  const candidates: FileMatch[] = [
    ...[...dirs].map((path) => ({ path, isDir: true })),
    ...files.map((path) => ({ path, isDir: false })),
  ];

  if (!q) {
    // No query yet: show the top level of the project.
    return candidates
      .filter((c) => !c.path.slice(0, c.isDir ? -1 : undefined).includes('/'))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.path.localeCompare(b.path))
      .slice(0, limit);
  }

  const scored: Array<[number, FileMatch]> = [];
  for (const c of candidates) {
    const score = scorePath(c.path.toLowerCase(), q);
    if (score > 0) scored.push([score - c.path.length * 0.01, c]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map(([, c]) => c);
}

function scorePath(path: string, q: string): number {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  if (base === q) return 100;
  if (base.startsWith(q)) return 80;
  if (base.includes(q)) return 60;
  if (path.startsWith(q)) return 50;
  if (path.includes(q)) return 40;
  // Subsequence match (e.g. "srcapi" → "src/lib/api.ts").
  let i = 0;
  for (const ch of path) if (ch === q[i]) i++;
  return i === q.length ? 10 : 0;
}
