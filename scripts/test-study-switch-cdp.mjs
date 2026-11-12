// Regression test: switching studies inside the viewer page.
//
// The viewer page renders BasicViewer with key={studyUID}, so a client-side
// navigation to another study remounts it. The primary pane of the new viewer
// must enable its viewport and show the new study, whatever the unmounting
// viewer still does: its teardown used to run 120 ms late and disable the
// viewport the new viewer had just enabled, leaving the pane empty. Each
// switch must disable the old primary viewport once and enable the new one
// once.

import {
  DEFAULT_STUDY_UID,
  MULTI_SERIES_STUDY_UID,
  PRIMARY_VIEWPORT_ID,
  RENDERER_ID,
  delay,
  runRegression,
  waitForPrimaryViewport,
} from './lib/cdp-harness.mjs';

const primaryStateExpression = `(() => {
  const viewport = window.__cornerstoneCore
    ?.getRenderingEngine?.('${RENDERER_ID}')
    ?.getViewport?.('${PRIMARY_VIEWPORT_ID}');
  let imageId = null;
  try { imageId = viewport?.getCornerstoneImage?.()?.imageId ?? null; } catch {}
  const pane = document.querySelector('[data-viewport-pane="${PRIMARY_VIEWPORT_ID}"]');
  return {
    study: new URLSearchParams(location.search).get('StudyInstanceUIDs'),
    viewport: Boolean(viewport),
    connected: Boolean(viewport?.element?.isConnected),
    inPane: Boolean(viewport?.element && pane?.contains(viewport.element)),
    status: String(viewport?.viewportStatus ?? '').toLowerCase(),
    imageId,
    loadingOverlay: [...(pane?.querySelectorAll('span.sr-only') ?? [])].some((node) =>
      /Đang nạp hình|Hoàn tất/.test(node.textContent ?? '')
    ),
    calls: window.__studySwitchCalls ?? null,
  };
})()`;

// Counts enableElement/disableElement calls for the primary viewport. The
// rendering engine is a page-wide singleton, so this survives the remount.
const installCallProbeExpression = `(() => {
  const engine = window.__cornerstoneCore.getRenderingEngine('${RENDERER_ID}');
  window.__studySwitchCalls = { enable: 0, disable: 0 };
  if (engine.__studySwitchProbe) return true;
  engine.__studySwitchProbe = true;
  const enableElement = engine.enableElement.bind(engine);
  const disableElement = engine.disableElement.bind(engine);
  engine.enableElement = (input) => {
    if (input?.viewportId === '${PRIMARY_VIEWPORT_ID}') window.__studySwitchCalls.enable += 1;
    return enableElement(input);
  };
  engine.disableElement = (viewportId) => {
    if (viewportId === '${PRIMARY_VIEWPORT_ID}') window.__studySwitchCalls.disable += 1;
    return disableElement(viewportId);
  };
  return true;
})()`;

// Every load of a study gives its image IDs a new cacheBust parameter.
const withoutCacheBust = (imageId) =>
  String(imageId ?? '').replace(/([?&])cacheBust=[^&]*&?/, '$1').replace(/[?&]$/, '');

const studyImagesExpression = `(() => {
  const viewport = window.__cornerstoneCore
    .getRenderingEngine('${RENDERER_ID}')
    .getViewport('${PRIMARY_VIEWPORT_ID}');
  return viewport.getImageIds();
})()`;

async function switchStudy(page, studyUID, previousImageIds) {
  await page.evaluate(installCallProbeExpression);
  const navigated = await page.evaluate(`(() => {
    if (typeof window.next?.router?.push !== 'function') return false;
    window.next.router.push(${JSON.stringify(
      `/viewer?StudyInstanceUIDs=${encodeURIComponent(studyUID)}`
    )});
    return true;
  })()`);
  if (!navigated) throw new Error('The Next.js router is not available.');

  const previous = JSON.stringify(previousImageIds.map(withoutCacheBust));
  const showsStudy = `(() => {
    const state = ${primaryStateExpression};
    const withoutCacheBust = ${withoutCacheBust.toString()};
    return state.study === ${JSON.stringify(studyUID)} &&
      state.connected && state.inPane && state.status === 'rendered' &&
      Boolean(state.imageId) &&
      !${previous}.includes(withoutCacheBust(state.imageId)) &&
      !state.loadingOverlay;
  })()`;
  await page.waitFor(showsStudy, `study ${studyUID} in the primary pane`, {
    timeoutMs: 60000,
    diagnostic: primaryStateExpression,
  });

  // The old viewer's late teardown fired 120 ms after the switch; stay well
  // past it before deciding the new viewport survived.
  await delay(1000);
  const state = await page.evaluate(primaryStateExpression);
  if (!(await page.evaluate(showsStudy))) {
    throw new Error(
      `The primary pane lost study ${studyUID} after the switch: ${JSON.stringify(state)}`
    );
  }
  if (state.calls?.enable !== 1 || state.calls?.disable !== 1) {
    throw new Error(
      `Expected one disable and one enable of the primary viewport, got ${JSON.stringify(
        state.calls
      )}.`
    );
  }
  return state;
}

await runRegression(
  'study-switch',
  async (page) => {
    await waitForPrimaryViewport(page);
    const firstStudyImages = await page.evaluate(studyImagesExpression);

    const second = await switchStudy(page, MULTI_SERIES_STUDY_UID, firstStudyImages);
    const secondStudyImages = await page.evaluate(studyImagesExpression);
    const back = await switchStudy(page, DEFAULT_STUDY_UID, secondStudyImages);

    if (!firstStudyImages.map(withoutCacheBust).includes(withoutCacheBust(back.imageId))) {
      throw new Error(`Switching back did not show the first study: ${back.imageId}`);
    }
    return {
      switches: [
        { study: second.study, calls: second.calls },
        { study: back.study, calls: back.calls },
      ],
    };
  },
  { studyUID: DEFAULT_STUDY_UID }
);
