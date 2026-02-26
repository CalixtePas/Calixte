import { mkdir, cp, rm } from 'node:fs/promises';

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/src', import.meta.url), { recursive: true });
await cp(new URL('../index.html', import.meta.url), new URL('../dist/index.html', import.meta.url));
await cp(new URL('../src/main.js', import.meta.url), new URL('../dist/src/main.js', import.meta.url));
console.log('Build complete: dist/');
