// src/lib/cornerstone.ts
'use client';

import * as csCoreStatic from '@cornerstonejs/core';
import { init as initTools, ToolGroupManager } from '@cornerstonejs/tools';
import { TOOL_GROUP } from '@/constants/toolgroup';
// import { registerCornerstoneToolsOnce } from './registerCornerstoneTools';
import { registerToolsOnce } from '@/lib/tools';


/**
 * File này khởi tạo Cornerstone core + tools + dicom-image-loader.
 * Mục tiêu:
 *  - idempotent (gọi nhiều lần an toàn)
 *  - expose một số helper/global cho phần còn lại của app
 *  - robust: phòng các lỗi runtime từ các lib bên ngoài
 */

let initialized = false;

function wrapReleaseGraphicsResourcesIfNeeded(obj: any) {
  try {
    if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return;

    const keys = Object.keys(obj || {});
    for (const key of keys) {
      try {
        let val: any;
        try {
          // Access property with Reflect.get inside try/catch (may throw for some exotic getters)
          val = Reflect.get(obj, key);
        } catch (getErr) {
          // If reading the property throws, skip this key
          if (process.env.NODE_ENV === 'development') {
            try {
              console.debug('[cornerstone] wrapRelease: skipping key (getter threw)', key, getErr);
            } catch {}
          }
          continue;
        }

        // Skip nullish and primitives
        if (val === null || val === undefined) continue;
        const t = typeof val;
        if (t !== 'object' && t !== 'function') continue;

        let current: any;
        try {
          current = Reflect.get(val, 'releaseGraphicsResources');
        } catch (e) {
          current = undefined;
        }

        // If property is a function, wrap it defensively
        if (typeof current === 'function') {
          try {
            // bind original if possible, but guard if binding fails
            let orig: Function | null = null;
            try {
              orig = current.bind(val);
            } catch {
              // if bind fails, try a safe call via Reflect
              orig = function (...args: any[]) {
                try {
                  return Reflect.apply(current, val, args);
                } catch (err) {
                  // swallow
                }
              } as any;
            }

            const wrapper = function safeRelease(...args: any[]) {
              try {
                if (orig) return orig(...args);
              } catch (er) {
                try { console.warn('[cornerstone] safeReleaseGraphicsResources caught', er); } catch {}
              }
            };

            // try to set wrapper; if not writable, ignore
            try {
              Reflect.set(val, 'releaseGraphicsResources', wrapper);
            } catch {
              // can't redefine - ignore
            }
          } catch (wrapErr) {
            // swallow per-key errors
            if (process.env.NODE_ENV === 'development') {
              try { console.debug('[cornerstone] wrapRelease per-key wrapErr', key, wrapErr); } catch {}
            }
          }
        } else {
          // if property not present or not function, try to set a safe noop if possible
          try {
            Reflect.set(val, 'releaseGraphicsResources', function safeNoopRelease() {});
          } catch {
            // ignore if not writable
          }
        }
      } catch (inner) {
        // swallow per-key errors
        if (process.env.NODE_ENV === 'development') {
          try { console.debug('[cornerstone] wrapReleaseGraphicsResources: per-key error', key, inner); } catch {}
        }
      }
    }
  } catch (outer) {
    if (process.env.NODE_ENV === 'development') {
      try {
        console.debug('[cornerstone] wrapReleaseGraphicsResources top-level error', outer);
        (window as any).__viewerLog = (window as any).__viewerLog || [];
        (window as any).__viewerLog.push({ t: Date.now(), msg: `wrapRelease:top err=${String(outer)}` });
      } catch {}
    }
  }
}

export async function initCornerstone() {
  if (typeof window === 'undefined') {
    return { csCore: null, dicomImageLoader: null };
  }

  if (initialized) {
    return {
      csCore: (window as any).__cornerstoneCore ?? null,
      dicomImageLoader: (window as any).__cornerstoneImageLoader ?? null,
    };
  }

  // instrumentation object (always present)
  try {
    (window as any).__cornerstoneStatus = (window as any).__cornerstoneStatus || {};
    (window as any).__cornerstoneStatus.initRequestedAt = Date.now();
  } catch {}

  let csCore: any = null;
  let dicomImageLoader: any = null;

  // 1) Prefer static import module as primary reference
  try {
    csCore = csCoreStatic;
    (window as any).__cornerstoneCore = csCore;
  } catch (err) {
    csCore = (window as any).__cornerstoneCore ?? null;
  }

  // 2) Try to call core.init() if available (idempotent)
  try {
    if (csCore && typeof csCore.init === 'function') {
      try { await csCore.init(); } catch (e) { /* non-fatal */ }
    }
  } catch {}

  // 3) init tools
  try {
    await initTools();
  } catch (err) {
    console.warn('[cornerstone] init tools failed', err);
    try { (window as any).__cornerstoneStatus.lastError = String(err); } catch {}
  }

  // 4) register tool classes (project-specific)
  try {
    // registerCornerstoneToolsOnce();
    registerToolsOnce();
  } catch (err) {
    console.warn('[cornerstone] registerToolsOnce failed', err);
    try { (window as any).__cornerstoneStatus.lastError = `[registerToolsOnce] ${String(err)}`; } catch {}
  }

  // 5) ensure tool group exists (silent on duplicate)
  try {
    ToolGroupManager.createToolGroup(TOOL_GROUP);
  } catch (err) {
    // ignore duplicates
    try { console.debug('[cornerstone] ToolGroup create may have failed / already exists', err); } catch {}
  }

  // 6) dynamic import dicom-image-loader (best-effort)
  try {
    const module = await import('@cornerstonejs/dicom-image-loader').catch(() => null);
    if (module) {
      dicomImageLoader = (module && (module.default || module)) as any;

      // safety wrapper for releaseGraphicsResources (workaround downstream bugs)
      try {
        wrapReleaseGraphicsResourcesIfNeeded(dicomImageLoader);
        if ((dicomImageLoader as any).default) wrapReleaseGraphicsResourcesIfNeeded((dicomImageLoader as any).default);
      } catch (err) {
        try { console.debug('[cornerstone] wrapReleaseGraphicsResources failed', err); } catch {}
      }

      // init dicom-image-loader with conservative worker count (cap to 2)
      try {
        // Reduce worker count to avoid overwhelming low-power clients.
        let maxWebWorkers = 1;
        try {
          const hc = (typeof navigator !== 'undefined' && (navigator as any).hardwareConcurrency) || 1;
          // cap to 2 workers for stability on weaker devices; keep at least 1
          maxWebWorkers = Math.max(1, Math.min(2, Math.floor(hc || 1)));
        } catch {}
        if (dicomImageLoader && typeof dicomImageLoader.init === 'function') {
          await dicomImageLoader.init({ maxWebWorkers });
        }
      } catch (err) {
        console.warn('[cornerstone] dicom-image-loader init failed', err);
        try { (window as any).__cornerstoneStatus.lastError = `[dicom-image-loader init] ${String(err)}`; } catch {}
      }

      // register wadouri loader and metadata provider (if available)
      try {
        if (dicomImageLoader.wadouri && typeof dicomImageLoader.wadouri.register === 'function') {
          try { dicomImageLoader.wadouri.register(); } catch (e) { console.warn('[cornerstone] wadouri.register failed', e); }
        }

        const provider = dicomImageLoader.wadouri?.metaData?.metaDataProvider ?? null;
        if (provider && csCore?.metaData && typeof csCore.metaData.addProvider === 'function') {
          try {
            csCore.metaData.addProvider(provider, 0);
          } catch (err) {
            console.warn('[cornerstone] addProvider(metaDataProvider) failed', err);
          }
        }
      } catch (err) {
        console.warn('[cornerstone] dicomImageLoader providers registration failed', err);
      }
    }
  } catch (err) {
    console.warn('[cornerstone] load dicom-image-loader failed', err);
  }

  // 7) Expose safe globals for convenience (prefer core.imageLoader where possible)
  try {
    (window as any).__cornerstoneCore = csCore ?? (window as any).__cornerstoneCore ?? null;
    (window as any).__cornerstoneImageLoader = dicomImageLoader ?? (window as any).__cornerstoneImageLoader ?? null;

    // prefer csCore.imageLoader.loadAndCacheImage if available
    try {
      const fn =
        csCore && (csCore as any).imageLoader && typeof (csCore as any).imageLoader.loadAndCacheImage === 'function'
          ? (csCore as any).imageLoader.loadAndCacheImage.bind((csCore as any).imageLoader)
          : null;

      // fallback: dicomImageLoader.wadouri.loadAndCacheImage
      const altFn = dicomImageLoader && dicomImageLoader.wadouri && typeof dicomImageLoader.wadouri.loadAndCacheImage === 'function'
        ? dicomImageLoader.wadouri.loadAndCacheImage.bind(dicomImageLoader.wadouri)
        : null;

      (window as any).__cornerstoneImageLoaderFn = fn ?? altFn ?? (window as any).__cornerstoneImageLoaderFn ?? null;
    } catch {
      (window as any).__cornerstoneImageLoaderFn = (window as any).__cornerstoneImageLoaderFn ?? null;
    }
  } catch {}

  // ===================================================
  // Defensive repeated patch for ImageMapper.unregisterGraphicsResources
  // (poll small window in case ImageMapper is defined after initCornerstone runs)
  // ===================================================
  try {
    function tryPatchImageMapperPrototype() {
      try {
        const tryPatchOne = (Im: any) => {
          if (!Im || !Im.prototype) return false;
          const proto = Im.prototype;
          if (proto.__patched_unregisterGraphicsResources) return true;

          const orig = proto.unregisterGraphicsResources;
          try {
            if (typeof orig === 'function') {
              proto.unregisterGraphicsResources = function safeUnregister(...args: any[]) {
                try {
                  return orig.apply(this, args);
                } catch (err) {
                  try { console.warn('[cornerstone] patched unregisterGraphicsResources caught', err); } catch {}
                  // swallow
                }
              };
            } else {
              proto.unregisterGraphicsResources = function noopUnregister() { /* no-op */ };
            }
            proto.__patched_unregisterGraphicsResources = true;
            try { console.debug('[cornerstone] patched ImageMapper.unregisterGraphicsResources', Im); } catch {}
            return true;
          } catch (err) {
            try { console.warn('[cornerstone] patchImageMapperOne failed', err); } catch {}
            return false;
          }
        };

        // common places
        const candidates = [
          (window as any).ImageMapper,
          (window as any).vtk?.ImageMapper,
          (window as any).__cornerstoneCore?.ImageMapper,
          (window as any).__cornerstoneCore?.vtk?.ImageMapper,
        ];
        for (const c of candidates) {
          if (tryPatchOne(c)) return true;
        }
      } catch (e) {
        try { console.warn('[cornerstone] tryPatchImageMapperPrototype top failed', e); } catch {}
      }
      return false;
    }

    // try immediately and also poll for a short window in case the class is loaded later
    try {
      tryPatchImageMapperPrototype();
      let tries = 0;
      const maxTries = 8;
      const id = window.setInterval(() => {
        try {
          tries += 1;
          if (tryPatchImageMapperPrototype() || tries >= maxTries) {
            clearInterval(id);
          }
        } catch {
          try { clearInterval(id); } catch {}
        }
      }, 250);
    } catch (e) {
      try { console.warn('[cornerstone] repeated patch scheduling failed', e); } catch {}
    }
  } catch (e) {
    try { console.warn('[cornerstone] scheduling repeated ImageMapper patch failed', e); } catch {}
  }

  // 8) instrumentation flags
  try {
    (window as any).__cornerstoneStatus = (window as any).__cornerstoneStatus || {};
    (window as any).__cornerstoneStatus.cornerstoneInitTime = Date.now();
    (window as any).__cornerstoneStatus.ready = true;
    (window as any).__cornerstoneStatus.imageLoaderAvailable = !!(window as any).__cornerstoneImageLoaderFn;
  } catch {}

  // ===================================================
  // Defensive monkey-patch: avoid crashes when ImageMapper.unregisterGraphicsResources
  // (bọc try/catch để swallow TypeError nếu inner implementation deref null)
  // ===================================================
  try {
    const csCoreAny: any = (window as any).__cornerstoneCore ?? csCore;
    // try common places where ImageMapper might live
    const ImageMapper =
      csCoreAny?.ImageMapper ??
      csCoreAny?.vtk?.ImageMapper ??
      (typeof (window as any).ImageMapper !== 'undefined' ? (window as any).ImageMapper : null) ??
      null;

    if (
      ImageMapper &&
      ImageMapper.prototype &&
      typeof ImageMapper.prototype.unregisterGraphicsResources === 'function'
    ) {
      try {
        const orig = ImageMapper.prototype.unregisterGraphicsResources;
        ImageMapper.prototype.unregisterGraphicsResources = function (...args: any[]) {
          try {
            return orig.apply(this, args);
          } catch (err) {
            try { console.warn('[cornerstone] patched ImageMapper.unregisterGraphicsResources caught', err); } catch {}
            // swallow to avoid unhandled TypeError when library tries to deref null
            return;
          }
        };
      } catch (e) {
        try { console.warn('[cornerstone] patch ImageMapper.unregisterGraphicsResources failed', e); } catch {}
      }
    }
  } catch (e) {
    try { console.warn('[cornerstone] patch ImageMapper.unregisterGraphicsResources outer failed', e); } catch {}
  }

  // Gọi helper global patch càng sớm càng tốt (theo yêu cầu)
  try {
    // disableReleaseGraphicsResourcesGlobally will try to wrap common globals safely
    disableReleaseGraphicsResourcesGlobally();
  } catch (e) {
    try { console.warn('[cornerstone] disableReleaseGraphicsResourcesGlobally call failed', e); } catch {}
  }

  (window as any).__cornerstoneReady = true;
  initialized = true;

  return {
    csCore: (window as any).__cornerstoneCore ?? null,
    dicomImageLoader: (window as any).__cornerstoneImageLoader ?? null,
  };
}

export default initCornerstone;

// ===================================================
// Utility: disableReleaseGraphicsResourcesGlobally
// Try to patch/wrap releaseGraphicsResources on common objects to avoid
// crashes when rendering pipeline calls release on objects that became null.
// This is a best-effort defensive shim — not perfect but reduces race crashes.
// ===================================================
let __cornerstone_release_globally_disabled = false;

export function disableReleaseGraphicsResourcesGlobally() {
  try {
    if (typeof window === 'undefined') return;
    if (__cornerstone_release_globally_disabled) return;
    __cornerstone_release_globally_disabled = true;

    const safeWrapVal = (val: any) => {
      try {
        if (!val || (typeof val !== 'object' && typeof val !== 'function')) return;

        let current: any;
        try {
          current = Reflect.get(val, 'releaseGraphicsResources');
        } catch {
          current = undefined;
        }

        if (current == null) {
          try {
            Reflect.set(val, 'releaseGraphicsResources', function safeNoopRelease() {
              /* no-op */
            });
          } catch {}
        } else if (typeof current === 'function') {
          try {
            const orig = current.bind ? current.bind(val) : null;
            const wrapper = function safeRelease(...args: any[]) {
              try {
                if (orig) return orig(...args);
              } catch (er) {
                try { console.warn('[cornerstone] safeRelease caught', er); } catch {}
                return;
              }
            };
            try { Reflect.set(val, 'releaseGraphicsResources', wrapper); } catch {}
          } catch {
            try { Reflect.set(val, 'releaseGraphicsResources', function safeNoopRelease() {}); } catch {}
          }
        } else {
          try { Reflect.set(val, 'releaseGraphicsResources', function safeNoopRelease() {}); } catch {}
        }
      } catch {
        // ignore
      }
    };

    // Small list of likely global anchors to try to patch
    const tryNames = [
      '__cornerstoneCore',
      '__cornerstoneImageLoader',
      'cornerstone',
      'Cornerstone',
      'vtk',
      'vtkRendering',
      'RenderingEngine',
      'ImageMapper',
      'publicAPI',
    ];

    for (const n of tryNames) {
      try {
        const v = (window as any)[n] ?? null;
        if (v) safeWrapVal(v);
      } catch {}
    }

    try {
      const keys = Object.keys(window).slice(0, 80); // limit scanning cost
      for (const k of keys) {
        try {
          const v = (window as any)[k];
          if (v && typeof v === 'object' && Object.keys(v || {}).length > 3) {
            safeWrapVal(v);
          }
        } catch {}
      }
    } catch {}

    try {
      if ((window as any).__cornerstoneImageLoader) safeWrapVal((window as any).__cornerstoneImageLoader);
      if ((window as any).__cornerstoneCore) safeWrapVal((window as any).__cornerstoneCore);
    } catch {}

    try { console.debug('[cornerstone] disableReleaseGraphicsResourcesGlobally: applied'); } catch {}
  } catch (e) {
    try { console.warn('[cornerstone] disableReleaseGraphicsResourcesGlobally failed', e); } catch {}
  }
}
