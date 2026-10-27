// Local dev server: builds data/ into a scratch dir and serves it at /codebase-trends/, as Pages does.
// `npm run dev` restarts it, and so rebuilds, whenever src/, scripts/, data/ or the config changes.
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};
export const PREFIX = '/codebase-trends/';

/** An HTTP server for the site built into dir, under PREFIX; not yet listening. */
export function siteServer(dir: string): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x').pathname;
    let file = url.startsWith(PREFIX) ? join(dir, normalize(url.slice(PREFIX.length))) : null;
    if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(tmpdir(), 'codebase-trends-dev');
  rmSync(out, { recursive: true, force: true });
  build({ out });
  const port = Number(process.env.PORT ?? 8090);
  siteServer(out).listen(port, 'localhost', () => console.log(`http://localhost:${port}${PREFIX}`));
}
