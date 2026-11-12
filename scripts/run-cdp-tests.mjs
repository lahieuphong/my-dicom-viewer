// Runs every viewer CDP regression with one command.
//
//   yarn test:cdp                         run all regressions
//   yarn test:cdp --only resize,sr-tools  run a subset
//   yarn test:cdp --list                  list regression names
//   yarn test:cdp --gpu                   start Chrome on the hardware GPU
//
// A viewer already listening on VIEWER_ORIGIN and a Chrome already exposing
// CDP_ORIGIN are reused. Otherwise this script starts `next dev --webpack`
// and a headless Chrome (CHROME_PATH overrides the binary), and stops
// whatever it started when it exits. Per-regression logs are kept in a
// temporary directory (CDP_LOG_DIR overrides it) and printed for failures.
//
// Chrome renders WebGL with SwiftShader by default, which works without a
// GPU (e.g. in CI) but loads and renders far slower. --gpu uses the hardware
// GPU instead: about 3x faster, and closer to what users run, so timing races
// that SwiftShader hides surface. Run both before relying on a change.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_STUDY_UID,
  PRIMARY_VIEWPORT_ID,
  RENDERER_ID,
  delay,
  openViewerPage,
} from './lib/cdp-harness.mjs';

const REGRESSIONS = [
  { name: 'invert', script: 'test-invert-cdp.mjs' },
  { name: 'resize', script: 'test-viewport-resize-cdp.mjs' },
  { name: 'layout', script: 'test-viewport-layout-cdp.mjs' },
  { name: 'toolbar-actions', script: 'test-viewport-toolbar-cdp.mjs' },
  { name: 'primary-series', script: 'test-primary-series-cdp.mjs' },
  { name: 'study-switch', script: 'test-study-switch-cdp.mjs' },
  { name: 'measurement-navigation', script: 'test-viewport-measurement-cdp.mjs' },
  { name: 'slice-sync', script: 'test-viewport-slice-sync-cdp.mjs' },
  { name: 'pane-tools', script: 'test-viewport-pane-tools-cdp.mjs' },
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
const useHardwareGpu = process.argv.includes('--gpu');
// CDP_LOG_DIR keeps the logs in a known place, e.g. for CI artifacts.
const logDir = process.env.CDP_LOG_DIR
  ? (mkdirSync(process.env.CDP_LOG_DIR, { recursive: true }), process.env.CDP_LOG_DIR)
  : mkdtempSync(path.join(tmpdir(), 'viewer-cdp-'));
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
  if (await isReachable(`${cdpOrigin}/json/version`)) {
    return useHardwareGpu ? 'reused; --gpu has no effect on it' : 'reused';
  }
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
      ...(useHardwareGpu
        ? []
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
      // e.g. CHROME_EXTRA_ARGS=--no-sandbox on CI runners without a sandbox.
      ...String(process.env.CHROME_EXTRA_ARGS ?? '').split(/\s+/).filter(Boolean),
      'about:blank',
    ],
    { cleanupPaths: [profileDir] }
  );
  await waitUntilReachable(`${cdpOrigin}/json/version`, 'Chrome', 30000, child);
  return useHardwareGpu ? 'started on the hardware GPU' : 'started with SwiftShader';
}

const DISPLAYED_IMAGE_EXPRESSION = `Boolean(
  window.__cornerstoneCore
    ?.getRenderingEngine?.(${JSON.stringify(RENDERER_ID)})
    ?.getViewport?.(${JSON.stringify(PRIMARY_VIEWPORT_ID)})
    ?.getCornerstoneImage?.()
)`;

/**
 * Loads the viewer once before the regressions. On the first browser load
 * after `next dev` starts, webpack may still be writing the ~1 MB
 * dicom-image-loader decode worker chunk when the page creates its workers;
 * the workers then receive a truncated script, fail with a SyntaxError and
 * never answer the first decode, so the first image never appears and the
 * first regression times out. A reload after the chunk is complete fixes
 * it. This is a dev-server race; production chunks are static. The viewer
 * now reloads itself once when that happens (decodeWorkerHealth.ts); this
 * reload stays as a fallback and still compiles the viewer before the
 * regressions.
 *
 * Waits for a displayed image, not viewportStatus: the stuck viewport still
 * reports 'rendered' after drawing its background.
 */
async function warmUpViewer() {
  const page = await openViewerPage();
  // Evaluating while the page reloads rejects; keep polling through it.
  const waitForDisplayedImage = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await page.evaluate(DISPLAYED_IMAGE_EXPRESSION)) return true;
      } catch {}
      await delay(250);
    }
    return false;
  };
  try {
    if (await waitForDisplayedImage(30000)) return 'ready';
    await page.cdp('Page.reload', { ignoreCache: true });
    if (await waitForDisplayedImage(60000)) return 'ready after a reload';
    return 'no image after a reload; the regressions will report it';
  } finally {
    await page.close();
  }
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

async function printLogTail(name, logPath, lines = 25) {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(logPath, 'utf8').catch(() => '');
  const logLines = text.split('\n');
  console.log(
    logLines
      .slice(-lines)
      .map((line) => `    ${line.slice(0, 400)}`)
      .join('\n')
  );

  // On GitHub Actions, surface the failure as an annotation: job logs need
  // admin rights to download, annotations are visible to every reader.
  if (process.env.GITHUB_ACTIONS === 'true') {
    const errorIndex = logLines.findIndex((line) => /\bError\b|Timed out|Timeout:/.test(line));
    const message = (errorIndex >= 0 ? logLines.slice(errorIndex, errorIndex + 4) : logLines.slice(-6))
      .join('\n')
      .slice(0, 1500);
    const escape = (value) =>
      value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::error title=CDP regression ${name} failed::${escape(message)}`);
  }
}

/**
 * Where a run spent its time: the setup phases and every regression. Printed
 * as one line; on GitHub Actions also written to the job summary and raised
 * as a notice annotation, because the job log needs admin rights to download
 * and annotations do not.
 */
async function reportTimings(setup, results) {
  const format = ([name, seconds]) => `${name} ${seconds.toFixed(1)}s`;
  const total = [...setup, ...results.map(({ name, seconds }) => [name, seconds])]
    .reduce((sum, [, seconds]) => sum + seconds, 0);
  console.log(`Setup: ${setup.map(format).join(', ')}. Total ${total.toFixed(0)}s.`);

  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const regressions = results.map(({ name, seconds }) => [name, seconds]);
  console.log(
    `::notice title=CDP timings (${total.toFixed(0)}s)::` +
      `${setup.map(format).join(', ')}; ${regressions.map(format).join(', ')}`
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    const rows = [
      ...setup.map(([name, seconds]) => `| ${name} | setup | ${seconds.toFixed(1)} |`),
      ...results.map(({ name, code, seconds }) =>
        `| ${name} | ${code === 0 ? 'passed' : 'failed'} | ${seconds.toFixed(1)} |`
      ),
    ];
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### CDP regressions (${total.toFixed(0)} s)\n\n| Step | Result | Seconds |\n| --- | --- | ---: |\n${rows.join('\n')}\n`
    ).catch(() => {});
  }
}

// Wait until what this run started has exited: a run started right after
// could otherwise find the previous Chrome still listening, reuse it while it
// shuts down and lose the CDP connection.
async function stopStartedProcesses(timeoutMs = 5000) {
  const stopping = started.reverse().map(({ child, cleanupPaths }) => {
    const exited =
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once('exit', resolve));
    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform === 'win32') child.kill();
        else process.kill(-child.pid, 'SIGTERM');
      } catch {}
    }
    return Promise.race([exited, delay(timeoutMs)]).then(() => {
      for (const cleanupPath of cleanupPaths) {
        try {
          rmSync(cleanupPath, { recursive: true, force: true });
        } catch {}
      }
    });
  });
  started.length = 0;
  await Promise.all(stopping);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await stopStartedProcesses();
    process.exit(130);
  });
}

try {
  const regressions = parseArguments(process.argv.slice(2));
  const setup = [];
  const timed = async (name, task) => {
    const startedAt = Date.now();
    try {
      return await task();
    } finally {
      setup.push([name, (Date.now() - startedAt) / 1000]);
    }
  };
  const viewer = await timed('viewer', ensureViewer);
  const chrome = await timed('chrome', ensureChrome);
  console.log(
    `Viewer ${viewerOrigin} (${viewer}), Chrome ${cdpOrigin} (${chrome}). Logs: ${logDir}`
  );
  console.log(`Warm-up: ${await timed('warm-up', warmUpViewer)}.`);

  const results = [];
  for (const regression of regressions) {
    process.stdout.write(`- ${regression.name} ... `);
    const result = await runRegressionScript(regression);
    results.push(result);
    console.log(
      `${result.code === 0 ? 'passed' : `FAILED (exit ${result.code})`} ` +
        `in ${result.seconds.toFixed(1)}s`
    );
    if (result.code !== 0) await printLogTail(result.name, result.logPath);
  }

  const failed = results.filter(({ code }) => code !== 0);
  console.log(
    `\n${results.length - failed.length}/${results.length} regressions passed.`
  );
  await reportTimings(setup, results);
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await stopStartedProcesses();
}
