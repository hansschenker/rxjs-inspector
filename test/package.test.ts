import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const tsc = join(root, 'node_modules/typescript/bin/tsc');

test('the packed library exposes usable ESM, TypeScript declarations, and a headless-safe viewer entry', { timeout: 60_000 }, () => {
  const temporary = mkdtempSync(join(root, '.package-test-'));
  try {
    execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json')], {
      cwd: root, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const packArgs = ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary, '--cache', join(temporary, 'npm-cache')];
    const npmCli = process.env.npm_execpath ?? (process.platform === 'win32'
      ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
      : undefined);
    const manifestText = npmCli
      ? execFileSync(process.execPath, [npmCli, ...packArgs], { cwd: root, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] })
      : execFileSync('npm', packArgs, { cwd: root, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const manifest = JSON.parse(manifestText) as Array<{ files: Array<{ path: string }> }>;
    const files = manifest[0]!.files.map(file => file.path);
    for (const expected of ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts', 'dist/viewer.js', 'dist/viewer.d.ts']) {
      assert.ok(files.includes(expected), `npm package must contain ${expected}`);
    }
    assert.equal(files.some(path => path.startsWith('node_modules/') || path.startsWith('test/')), false);

    // Materialize precisely npm's file list. The surrounding project supplies the
    // already-installed RxJS peer, so this integration test needs no network.
    const consumer = join(temporary, 'consumer');
    const packageDirectory = join(consumer, 'node_modules/@hansschenker/rxjs-inspector');
    for (const relative of files) {
      assert.ok(!relative.split('/').includes('..'));
      const destination = join(packageDirectory, relative);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, relative), destination);
    }
    writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
    writeFileSync(join(consumer, 'consumer.mts'), `
import { createInspector, parseTrace, serializeTrace, type Trace } from '@hansschenker/rxjs-inspector';
import { mountInspector } from '@hansschenker/rxjs-inspector/viewer';
import { of } from 'rxjs';

const inspector = createInspector({
  nodes: [
    { id: 'source', label: 'source$', kind: 'source' },
    { id: 'latest', label: 'latest', kind: 'operator', operator: 'switchMap' },
  ],
});
function twice$(value: number) { return of(value * 2); }
function invalidProject(value: number) { return value * 2; }
// @ts-expect-error Domain projection must produce an ObservableInput.
inspector.switchMap('latest', invalidProject);
const values: number[] = [];
of(1, 2).pipe(inspector.inspect<number>('source'), inspector.switchMap('latest', twice$))
  .subscribe(value => values.push(value));
const trace: Trace = parseTrace(serializeTrace(inspector.getTrace()));
if (JSON.stringify(values) !== '[2,4]') throw new Error('packaged runtime did not deliver expected values');
if (trace.events.length === 0) throw new Error('packaged runtime did not record events');
if (typeof mountInspector !== 'function') throw new Error('viewer export is missing');
if (typeof globalThis.document !== 'undefined') throw new Error('headless consumer unexpectedly has a DOM');
console.log('package consumer passed');
`);
    const buildDirectory = join(consumer, 'build');
    execFileSync(process.execPath, [tsc, '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--outDir', buildDirectory, join(consumer, 'consumer.mts')], {
      cwd: consumer, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = execFileSync(process.execPath, [join(buildDirectory, 'consumer.mjs')], {
      cwd: consumer, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(result, /package consumer passed/);
    const installedManifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')) as { peerDependencies: { rxjs: string } };
    assert.equal(installedManifest.peerDependencies.rxjs, '7.8.2');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
