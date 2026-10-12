'use strict';
/**
 * Zero-dependency static file server for the Evoker web recreation.
 * Usage: node tools/serve.js [port] [--root=dir]   (default 8080, or PORT env var; root: the project)
 * Serves the root with correct MIME types and no caching so edits show immediately. `--root=dist` previews
 * the staged site (tools/stage-site.js) the way a static host would see it (`npm run preview`).
 */
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootArg = args.find((a) => a.startsWith('--root='));
const ROOT = resolve(rootArg ? rootArg.slice('--root='.length) : fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(args.find((a) => !a.startsWith('--')) || process.env.PORT || 8080);

/** @type {Record<string, string>} */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/**
 * Resolve a request URL to a file path inside ROOT, or null when it escapes the root.
 * @param {string} url
 * @returns {string|null}
 */
export function resolvePath(url) {
  let pathname = decodeURIComponent(url.split('?')[0].split('#')[0]);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const full = normalize(join(ROOT, pathname));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

export const server = createServer(async (req, res) => {
  const filePath = resolvePath(req.url || '/');
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  try {
    let target = filePath;
    let info = await stat(target);
    if (info.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target);
    }
    const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream';
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 Not Found: ${req.url}`);
  }
});

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(PORT, () => {
    console.log(`Evoker dev server running at http://localhost:${PORT}/`);
    console.log(`Serving ${ROOT}  (Ctrl+C to stop)`);
  });
}
