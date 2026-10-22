import { readdir } from 'node:fs/promises';

// node:test runs imported tests automatically. Loading them in one process avoids
// version-specific isolation flags and shell-dependent glob expansion on Windows.
const directory = new URL('../test/', import.meta.url);
const files = (await readdir(directory)).filter(name => name.endsWith('.test.ts')).sort();
if (files.length === 0) throw new Error('No test files found.');
for (const name of files) await import(new URL(name, directory).href);
