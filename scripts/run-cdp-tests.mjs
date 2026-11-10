// Runs every viewer CDP regression with one command.
//
//   yarn test:cdp                         run all regressions
//   yarn test:cdp --only resize,sr-tools  run a subset
//   yarn test:cdp --list                  list regression names
//
// A viewer already listening on VIEWER_ORIGIN and a Chrome already exposing
// CDP_ORIGIN are reused. Otherwise this script starts `next dev --webpack`
// and a headless Chrome (CHROME_PATH overrides the binary), and stops
// whatever it started when it exits. Per-regression logs are kept in a
// temporary directory and printed for failures.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_STUDY_UID, delay } from './lib/cdp-harness.mjs';

const REGRESSIONS = [
  { name: 'invert', script: 'test-invert-cdp.mjs' },
  { name: 'resize', script: 'test-viewport-resize-cdp.mjs' },
  { name: 'layout', script: 'test-viewport-layout-cdp.mjs' },
  { name: 'toolbar-actions', script: 'test-viewport-toolbar-cdp.mjs' },
  { name: 'measurement-navigation', script: 'test-viewport-measurement-cdp.mjs' },
  { name: 'sr-workflow', script: 'debug-viewer-cdp.mjs' },
  { name: 'sr-tools', script: 'test-all-sr-tools-cdp.mjs' },
  // Single-contour runs also cover hide/show, SR hydration and deletion.
  {
    name: 'sr-contour-freehand',
    script: 'test-all-sr-tools-cdp.mjs',
    env: { SR_SINGLE_TOOL: 'planarFreehandROI' },
  },
  {
    name: 'sr-contour-livewire',
    script: 'test-all-sr-tools-cdp.mjs',
    env: { SR_SINGLE_TOOL: 'livewireContour' },
  },
];

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewerOrigin = process.env.VIEWER_ORIGIN ?? 'http://127.0.0.1:3000';
const cdpOrigin = process.env.CDP_ORIGIN ?? 'http://127.0.0.1:9222';
const viewerUrl = `${viewerOrigin}/viewer?StudyInstanceUIDs=${
  process.env.STUDY_INSTANCE_UID ?? DEFAULT_STUDY_UID
}`;
const logDir = mkdtempSync(path.join(tmpdir(), 'viewer-cdp-'));
const started = [];

function parseArguments(argv) {
  if (argv.includes('--list')) {
    for (const { name } of availableRegressions()) console.log(name);
    process.exit(0);
  }
  const onlyIndex = argv.indexOf('--only');
  if (onlyIndex === -1) return availableRegressions();

  const names = String(argv[onlyIndex + 1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = names.filter(
    (name) => !REGRESSIONS.some((regression) => regression.name === name)
  );
  if (names.length === 0 || unknown.length > 0) {
    throw new Error(
      `Unknown regression(s): ${unknown.join(', ') || '(none given)'}. ` +
        `Use --list to see the available names.`
    );
  }
  return availableRegressions().filter(({ name }) => names.includes(name));
}

function availableRegressions() {
  const missing = REGRESSIONS.filter(
    ({ script }) => !existsSync(path.join(projectRoot, 'scripts', script))
  );
  if (missing.length > 0) {
    throw new Error(
      `Regression script(s) missing: ${missing.map(({ script }) => script).join(', ')}`
    );
  }
  return REGRESSIONS;
}

async function isReachable(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitUntilReachable(url, label, timeoutMs, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child && child.exitCode !== null) {
      throw new Error(`${label} exited early with code ${child.exitCode}.`);
    }
    // The first viewer request compiles the route; allow it to take a while.
    if (await isReachable(url, 60000)) return;
    await delay(500);
  }
  throw new Error(`${label} did not become reachable at ${url}.`);
}

function startProcess(label, command, args, { env, cleanupPaths = [] } = {}) {
  const logPath = path.join(logDir, `${label}.log`);
  const log = createWriteStream(logPath);
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group, so the whole tree (Next.js workers, Chrome helpers)
    // can be stopped together.
    detached: process.platform !== 'win32',
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  started.push({ label, child, cleanupPaths });
  return child;
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
  }[process.platform] ?? [];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('Chrome was not found. Set CHROME_PATH to its binary.');
  }
  return found;
}

async function ensureViewer() {
  if (await isReachable(viewerOrigin)) return 'reused';
  const { hostname, port } = new URL(viewerOrigin);
  const child = startProcess('next-dev', process.execPath, [
    path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
    'dev',
    '--webpack',
    '--hostname',
    hostname,
    '--port',
    port || '3000',
  ]);
  await waitUntilReachable(viewerUrl, 'next dev', 240000, child);
  return 'started';
}

async function ensureChrome() {
  if (await isReachable(`${cdpOrigin}/json/version`)) return 'reused';
  const { port } = new URL(cdpOrigin);
  const profileDir = mkdtempSync(path.join(tmpdir(), 'viewer-cdp-chrome-'));
  const child = startProcess(
    'chrome',
    findChrome(),
    [
      '--headless=new',
      `--remote-debugging-port=${port || '9222'}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1600,1000',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      'about:blank',
    ],
    { cleanupPaths: [profileDir] }
  );
  await waitUntilReachable(`${cdpOrigin}/json/version`, 'Chrome', 30000, child);
  return 'started';
}

function runRegressionScript({ name, script, env = {} }) {
  const logPath = path.join(logDir, `${name}.log`);
  const log = createWriteStream(logPath);
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(projectRoot, 'scripts', script)],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ...env,
          VIEWER_ORIGIN: viewerOrigin,
          CDP_ORIGIN: cdpOrigin,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.on('close', (code) => {
      log.end(() =>
        resolve({ name, code, seconds: (Date.now() - startedAt) / 1000, logPath })
      );
    });
  });
}

async function printLogTail(logPath, lines = 25) {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(logPath, 'utf8').catch(() => '');
  console.log(
    text
      .split('\n')
      .slice(-lines)
      .map((line) => `    ${line.slice(0, 400)}`)
      .join('\n')
  );
}

function stopStartedProcesses() {
  for (const { child, cleanupPaths } of started.reverse()) {
    if (child.exitCode === null) {
      try {
        if (process.platform === 'win32') child.kill();
        else process.kill(-child.pid, 'SIGTERM');
      } catch {}
    }
    for (const cleanupPath of cleanupPaths) {
      try {
        rmSync(cleanupPath, { recursive: true, force: true });
      } catch {}
    }
  }
  started.length = 0;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopStartedProcesses();
    process.exit(130);
  });
}

try {
  const regressions = parseArguments(process.argv.slice(2));
  const viewer = await ensureViewer();
  const chrome = await ensureChrome();
  console.log(
    `Viewer ${viewerOrigin} (${viewer}), Chrome ${cdpOrigin} (${chrome}). Logs: ${logDir}`
  );

  const results = [];
  for (const regression of regressions) {
    process.stdout.write(`- ${regression.name} ... `);
    const result = await runRegressionScript(regression);
    results.push(result);
    console.log(
      `${result.code === 0 ? 'passed' : `FAILED (exit ${result.code})`} ` +
        `in ${result.seconds.toFixed(1)}s`
    );
    if (result.code !== 0) await printLogTail(result.logPath);
  }

  const failed = results.filter(({ code }) => code !== 0);
  console.log(
    `\n${results.length - failed.length}/${results.length} regressions passed.`
  );
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  stopStartedProcesses();
}
