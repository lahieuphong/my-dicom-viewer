#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const sourceRoot = path.join(projectRoot, 'src');
const platformCoreRoot = path.join(sourceRoot, 'platform', 'core');
const serverRoot = path.join(sourceRoot, 'server');
const appApiRoot = path.join(sourceRoot, 'app', 'api');
const appViewerRoot = path.join(sourceRoot, 'app', 'viewer');
const deprecatedServerFacade = path.join(
  sourceRoot,
  'lib',
  'pacs',
  'dicomIndex.ts'
);

const codeExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

const violations = [];
const seenViolations = new Set();

function isWithin(filePath, directoryPath) {
  const relativePath = path.relative(directoryPath, filePath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..')
  );
}

function toProjectPath(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function addViolation(filePath, source, index, rule, message) {
  const line = lineNumberAt(source, Math.max(0, index));
  const key = `${filePath}:${line}:${rule}:${message}`;
  if (seenViolations.has(key)) return;
  seenViolations.add(key);
  violations.push({ filePath, line, rule, message });
}

function walkCodeFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) return [];

  const files = [];
  const stack = [directoryPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (
        entry.isFile() &&
        codeExtensions.has(path.extname(entry.name))
      ) {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

function collectModuleSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s*)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push({ value: match[1], index: match.index });
    }
  }

  return specifiers;
}

function resolveInternalImport(importerPath, specifier) {
  if (specifier === '@') return sourceRoot;
  if (specifier.startsWith('@/')) {
    return path.resolve(sourceRoot, specifier.slice(2));
  }
  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(importerPath), specifier);
  }
  return null;
}

function stripCommentsAndStrings(source) {
  const output = source.split('');
  let state = 'code';
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'code') {
      if (char === '/' && next === '/') {
        output[index] = ' ';
        output[index + 1] = ' ';
        state = 'line-comment';
        index += 1;
      } else if (char === '/' && next === '*') {
        output[index] = ' ';
        output[index + 1] = ' ';
        state = 'block-comment';
        index += 1;
      } else if (char === "'") {
        output[index] = ' ';
        state = 'single-quote';
        escaped = false;
      } else if (char === '"') {
        output[index] = ' ';
        state = 'double-quote';
        escaped = false;
      } else if (char === '`') {
        output[index] = ' ';
        state = 'template';
        escaped = false;
      }
      continue;
    }

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code';
      } else {
        output[index] = ' ';
      }
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        output[index] = ' ';
        output[index + 1] = ' ';
        state = 'code';
        index += 1;
      } else if (char !== '\n') {
        output[index] = ' ';
      }
      continue;
    }

    if (char === '\n') {
      output[index] = '\n';
    } else {
      output[index] = ' ';
    }

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }

    const closesState =
      (state === 'single-quote' && char === "'") ||
      (state === 'double-quote' && char === '"') ||
      (state === 'template' && char === '`');
    if (closesState) state = 'code';
  }

  return output.join('');
}

function classifyForbiddenCoreImport(filePath, specifier) {
  if (/^(?:react|react-dom)(?:\/|$)/.test(specifier)) return 'React';
  if (/^next(?:\/|$)/.test(specifier)) return 'Next.js';
  if (
    /^@cornerstonejs(?:\/|$)/.test(specifier) ||
    /^cornerstone(?:-|\/|$)/.test(specifier)
  ) {
    return 'Cornerstone';
  }
  if (/^(?:node:)?fs(?:\/|$)/.test(specifier)) return 'filesystem';

  const target = resolveInternalImport(filePath, specifier);
  if (!target) return null;

  const forbiddenInternalRoots = [
    ['extensions', path.join(sourceRoot, 'extensions')],
    ['components', path.join(sourceRoot, 'components')],
    ['hooks', path.join(sourceRoot, 'hooks')],
    ['server', serverRoot],
  ];

  for (const [label, directoryPath] of forbiddenInternalRoots) {
    if (isWithin(target, directoryPath)) return label;
  }

  return null;
}

function checkPlatformCore(files) {
  for (const filePath of files) {
    if (!isWithin(filePath, platformCoreRoot)) continue;
    const source = fs.readFileSync(filePath, 'utf8');

    for (const specifier of collectModuleSpecifiers(source)) {
      const forbiddenKind = classifyForbiddenCoreImport(
        filePath,
        specifier.value
      );
      if (forbiddenKind) {
        addViolation(
          filePath,
          source,
          specifier.index,
          'platform-core-import',
          `platform/core must not import ${forbiddenKind}: ${specifier.value}`
        );
      }
    }

    const executableSource = stripCommentsAndStrings(source);
    const forbiddenGlobalPattern = /\b(window|document|fs)\b/g;
    let globalMatch;
    while ((globalMatch = forbiddenGlobalPattern.exec(executableSource))) {
      addViolation(
        filePath,
        source,
        globalMatch.index,
        'platform-core-runtime',
        `platform/core must not use ${globalMatch[1]}`
      );
    }
  }
}

function canImportServerBoundary(filePath) {
  return (
    isWithin(filePath, serverRoot) ||
    isWithin(filePath, appApiRoot) ||
    path.resolve(filePath) === path.resolve(deprecatedServerFacade)
  );
}

function checkServerBoundary(files) {
  for (const filePath of files) {
    if (canImportServerBoundary(filePath)) continue;
    const source = fs.readFileSync(filePath, 'utf8');

    for (const specifier of collectModuleSpecifiers(source)) {
      const target = resolveInternalImport(filePath, specifier.value);
      if (target && isWithin(target, serverRoot)) {
        addViolation(
          filePath,
          source,
          specifier.index,
          'server-boundary',
          `non-server source must not import server boundary: ${specifier.value}`
        );
      }
    }
  }
}

function targetsLegacyViewer(filePath, specifier) {
  if (/^@\/components\/Viewer\/Viewer(?:\.[^/]*)?$/.test(specifier)) {
    return true;
  }

  const target = resolveInternalImport(filePath, specifier);
  if (!target) return false;
  const withoutExtension = target.replace(/\.(?:tsx?|jsx?)$/, '');
  return (
    path.resolve(withoutExtension) ===
    path.resolve(sourceRoot, 'components', 'Viewer', 'Viewer')
  );
}

function checkViewerRoutes(files) {
  for (const filePath of files) {
    if (!isWithin(filePath, appViewerRoot)) continue;
    const source = fs.readFileSync(filePath, 'utf8');

    for (const specifier of collectModuleSpecifiers(source)) {
      if (targetsLegacyViewer(filePath, specifier.value)) {
        addViolation(
          filePath,
          source,
          specifier.index,
          'viewer-route-boundary',
          `viewer routes must import the mode, not legacy Viewer: ${specifier.value}`
        );
      }
    }
  }
}

const sourceFiles = walkCodeFiles(sourceRoot);
checkPlatformCore(sourceFiles);
checkServerBoundary(sourceFiles);
checkViewerRoutes(sourceFiles);

if (violations.length > 0) {
  violations.sort((left, right) => {
    const fileOrder = left.filePath.localeCompare(right.filePath);
    return fileOrder || left.line - right.line || left.rule.localeCompare(right.rule);
  });

  console.error(`Architecture check failed with ${violations.length} violation(s):`);
  for (const violation of violations) {
    console.error(
      `- ${toProjectPath(violation.filePath)}:${violation.line} ` +
        `[${violation.rule}] ${violation.message}`
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    `Architecture check passed (${sourceFiles.length} source files checked).`
  );
}
