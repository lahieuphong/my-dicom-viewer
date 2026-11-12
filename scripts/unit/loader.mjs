// Module resolution for the unit tests (`yarn test:unit`).
//
// Node 24 runs TypeScript sources natively by stripping types, so the tests
// import framework-free modules from src/ directly. This hook adds what the
// Next.js bundler normally provides: the `@/` alias and extensionless
// imports. Packages that need a browser (Cornerstone) resolve to stubs, so a
// module under test must only reach them for code it does not exercise.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = new URL('../../src/', import.meta.url);
const stubs = {
  '@cornerstonejs/core': new URL('./stubs/cornerstone-core.mjs', import.meta.url),
  '@cornerstonejs/tools': new URL('./stubs/cornerstone-tools.mjs', import.meta.url),
};
function resolveSourceFile(base) {
  const path = fileURLToPath(base);
  if (/\.[cm]?[jt]sx?$/.test(path) && existsSync(path)) return base.href;
  for (const suffix of ['.ts', '.tsx', '/index.ts']) {
    if (existsSync(path + suffix)) return pathToFileURL(path + suffix).href;
  }
  return null;
}

// The package has no "type" field, so declare src/ TypeScript as ES modules
// instead of letting Node guess (and warn) for every file.
function sourceResult(url) {
  return /\.tsx?$/.test(url)
    ? { url, format: 'module-typescript', shortCircuit: true }
    : { url, shortCircuit: true };
}

export async function resolve(specifier, context, nextResolve) {
  if (stubs[specifier]) {
    return { url: stubs[specifier].href, shortCircuit: true };
  }

  if (specifier.startsWith('@/')) {
    const url = resolveSourceFile(new URL(specifier.slice(2), sourceRoot));
    if (url) return sourceResult(url);
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const url = resolveSourceFile(new URL(specifier, context.parentURL));
    if (url?.startsWith(sourceRoot.href)) return sourceResult(url);
  }

  return nextResolve(specifier, context);
}
