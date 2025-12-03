// scripts/run-ts.cjs
// Generic runner to execute a TypeScript file with ts-node, even in ESM projects.

const path = require('node:path');

// Register ts-node so Node can understand .ts files
require('ts-node').register({
  transpileOnly: true, // faster, fine for CLIs
});

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/run-ts.cjs <path/to/file.ts> [args...]');
  process.exit(1);
}

const tsFile = path.resolve(args[0]);

// Forward any additional args to the TS script if needed
process.argv = [process.argv[0], tsFile, ...args.slice(1)];

// Load the TypeScript file
require(tsFile);
