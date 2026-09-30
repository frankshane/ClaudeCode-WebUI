import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { Context } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Serves the built SPA from `root`, falling back to index.html for client routes. */
export function staticHandler(root: string) {
  const indexPath = join(root, 'index.html');
  return async (c: Context) => {
    if (!existsSync(indexPath)) {
      return c.text('前端尚未构建。开发时请访问 Vite 地址，或先运行 npm run build。', 503);
    }
    const rel = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^[/\\]+/, '');
    let file = join(root, rel);
    if (!file.startsWith(root + sep) || !existsSync(file) || extname(file) === '') file = indexPath;
    const body = await readFile(file);
    const headers: Record<string, string> = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' };
    if (file.includes(`${sep}assets${sep}`)) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    return c.body(body, 200, headers);
  };
}
