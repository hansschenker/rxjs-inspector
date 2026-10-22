import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(project, '.demo');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(project, 'examples/demo.ts')],
  outfile: resolve(output, 'demo.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  logLevel: 'info',
});
await copyFile(resolve(project, 'examples/index.html'), resolve(output, 'index.html'));

if (process.argv.includes('--build-only')) {
  console.log('Demo built in .demo/.');
} else {
  const portArgument = process.argv.indexOf('--port');
  const port = Number(portArgument >= 0 ? process.argv[portArgument + 1] : process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Provide a port between 1 and 65535.');
  const assets = new Map([
    ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
    ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
    ['/demo.js', { file: 'demo.js', type: 'text/javascript; charset=utf-8' }],
    ['/demo.js.map', { file: 'demo.js.map', type: 'application/json; charset=utf-8' }],
  ]);
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const asset = assets.get(url.pathname);
    if (!asset) { response.writeHead(404).end('Not found'); return; }
    try {
      const content = await readFile(resolve(output, asset.file));
      response.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      response.writeHead(500).end('Unable to read demo asset');
    }
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`RxJS Inspector: http://127.0.0.1:${port}\nPress Ctrl+C to stop.`));
}
