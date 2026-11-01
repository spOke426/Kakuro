import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

// A development server only. GitHub Pages supplies the production web server.
export function createPreviewServer(prefix = '/') {
  if (!prefix.startsWith('/') || !prefix.endsWith('/')) throw new Error('The preview prefix must start and end with /.');
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('Method not allowed.'); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (prefix !== '/' && pathname === prefix.slice(0, -1)) {
        res.writeHead(301, { Location: prefix }); res.end(); return;
      }
      if (!pathname.startsWith(prefix) || pathname.includes('\\') || pathname.includes('\0')) {
        res.writeHead(404); res.end('Not found.'); return;
      }
      let requested = pathname.slice(prefix.length);
      if (!requested || requested.endsWith('/')) requested += 'index.html';
      const target = resolve(publicRoot, requested);
      const distance = relative(publicRoot, target);
      if (distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) {
        res.writeHead(404); res.end('Not found.'); return;
      }
      const content = await readFile(target);
      res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      res.writeHead(error instanceof URIError ? 400 : 404);
      res.end('Not found.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 8080);
  const server = createPreviewServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Kakuro: http://127.0.0.1:${port}\nPress Ctrl+C to stop.`));
}
