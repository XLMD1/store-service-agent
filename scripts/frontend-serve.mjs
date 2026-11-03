// No repository-wide static middleware: only the frontend asset allowlist is served.
import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const built = process.argv.includes('--dist');
const base = path.join(root, built ? 'dist' : 'app/web');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) throw new Error('Invalid path');
    let relative;
    if (built) relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    else if (['/', '/index.html', '/mock.html', '/web/mock.html'].includes(pathname)) relative = 'mock.html';
    else if (pathname.startsWith('/web/')) relative = pathname.slice(5);
    else throw new Error('Unmapped path');
    const extension = path.extname(relative);
    if (!Object.hasOwn(contentTypes, extension) || (!built && extension === '.json')) throw new Error('Unserved type');
    // realpath also prevents symlink escapes into local configuration or secrets.
    const resolvedBase = await realpath(base);
    const target = await realpath(path.join(base, relative));
    if (!target.startsWith(resolvedBase + path.sep) || !(await stat(target)).isFile()) throw new Error('Outside static root');
    const data = await readFile(target);
    response.writeHead(200, { 'Content-Type': contentTypes[extension], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});
server.listen(8765, '127.0.0.1', () => console.log(`Mock preview: http://127.0.0.1:8765/${built ? '' : 'mock.html'} (${built ? 'dist' : 'app/web'} only)`));
