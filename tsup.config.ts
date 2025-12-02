// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig([
  // Library entry (instrumentation + visualization)
  {
    entry: {
      index: 'src/index.ts',
    },
    dts: true,
    sourcemap: true,
    clean: true,
    format: ['cjs', 'esm'],
    target: 'node18',
  },
  // CLI + web server (Node-only, CJS)
  {
    entry: {
      'cli/bin': 'src/cli/bin.ts',
      'web/server': 'src/web/server.ts',
    },
    platform: 'node',
    format: ['cjs'],
    sourcemap: true,
    clean: false,
    target: 'node18',
  },
]);
