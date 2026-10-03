/** Tiny static server for the local test page (GSAP + Lenis served from node_modules). */
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** nearest node_modules containing gsap (works with npm workspaces hoisting) */
function findModules(dir: string): string {
  for (let d = dir; ; d = path.dirname(d)) {
    if (existsSync(path.join(d, 'node_modules', 'gsap'))) return path.join(d, 'node_modules');
    if (path.dirname(d) === d) throw new Error('gsap not installed');
  }
}
const mods = findModules(root);

const routes: Record<string, string> = {
  '/vendor/gsap/gsap.min.js': path.join(mods, 'gsap/dist/gsap.min.js'),
  '/vendor/gsap/ScrollTrigger.min.js': path.join(mods, 'gsap/dist/ScrollTrigger.min.js'),
  '/vendor/lenis/lenis.min.js': path.join(mods, 'lenis/dist/lenis.min.js'),
  '/vendor/lenis/lenis.css': path.join(mods, 'lenis/dist/lenis.css'),
};
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webm': 'video/webm' };
const colors = ['#3a86ff', '#ff006e', '#06d6a0', '#ffbe0b', '#8338ec'];

export function startServer(port = 0): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const img = /^\/img\/(\d+)\.svg$/.exec(url.pathname);
    if (img) {
      // simulated slow image (lazy loading test)
      await new Promise((r) => setTimeout(r, Number(url.searchParams.get('delay') ?? 300)));
      const c = colors[Number(img[1]) % colors.length];
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': url.searchParams.has('delay') ? 'no-store' : 'max-age=3600' });
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="${c}"/>` +
        `<text x="800" y="520" font-size="260" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">IMG ${img[1]}</text></svg>`);
      return;
    }
    const file = routes[url.pathname] ?? path.join(root, 'site', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    try {
      const body = await readFile(file);
      const type = types[path.extname(file)] ?? 'application/octet-stream';
      // Range support: media elements can only seek with it
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 });
        res.end(body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, url: `http://127.0.0.1:${p}/` });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 4173);
  startServer(port).then(({ url }) => console.log(`test site: ${url}`));
}
