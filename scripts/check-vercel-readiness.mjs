#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, 'public', 'dicom-manifest.json');
const isVercelBuild = process.env.VERCEL === '1';
const errors = [];
const warnings = [];

const pacsApiBase = process.env.NEXT_PUBLIC_PACS_API_BASE?.trim() ?? '';
const dicomAssetBase =
  process.env.NEXT_PUBLIC_DICOM_ASSET_BASE?.trim() ?? '';
const authBackendBase = process.env.AUTH_BACKEND_BASE_URL?.trim() ?? '';
const allowEmptyDataSourceValue =
  process.env.ALLOW_EMPTY_DATA_SOURCE?.trim().toLowerCase() ?? '';
const allowEmptyDataSource = ['1', 'true'].includes(allowEmptyDataSourceValue);

if (
  allowEmptyDataSourceValue &&
  !['0', '1', 'false', 'true'].includes(allowEmptyDataSourceValue)
) {
  errors.push('ALLOW_EMPTY_DATA_SOURCE must be 0, 1, false, or true.');
}

function isLoopback(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function validateBaseUrl(name, value) {
  if (!value) return;

  try {
    const url = new URL(value);
    const isHttpProtocol = url.protocol === 'http:' || url.protocol === 'https:';
    const loopback = isLoopback(url.hostname);

    if (!isHttpProtocol) {
      errors.push(`${name} must use the HTTP or HTTPS protocol.`);
    } else if (isVercelBuild && (url.protocol !== 'https:' || loopback)) {
      errors.push(`${name} must use a non-loopback HTTPS URL on Vercel.`);
    } else if (!isVercelBuild && url.protocol !== 'https:' && !loopback) {
      warnings.push(`${name} must use HTTPS outside local development.`);
    }

    if (url.username || url.password) {
      errors.push(`${name} must not contain credentials in the URL.`);
    }

    if (url.search || url.hash) {
      const message = `${name} must not contain a query string or fragment.`;
      (isVercelBuild ? errors : warnings).push(message);
    }
  } catch {
    errors.push(`${name} must be an absolute URL.`);
  }
}

function readManifestStatus() {
  if (!fs.existsSync(manifestPath)) {
    return { exists: false, studyCount: 0, instanceCount: 0, missingFiles: 0 };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const studies = Array.isArray(payload) ? payload : payload?.studies;

    if (!Array.isArray(studies)) {
      errors.push('public/dicom-manifest.json has no studies array.');
      return { exists: true, studyCount: 0, instanceCount: 0, missingFiles: 0 };
    }

    let instanceCount = 0;
    let missingFiles = 0;

    for (const study of studies) {
      const seriesList = Array.isArray(study?.series) ? study.series : [];
      for (const series of seriesList) {
        const instances = Array.isArray(series?.instances) ? series.instances : [];
        for (const instance of instances) {
          const rawUrl =
            typeof instance === 'string'
              ? instance
              : instance?.url ?? instance?.filename ?? '';

          if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
            continue;
          }

          instanceCount += 1;

          if (!rawUrl.startsWith('/dicoms/')) {
            continue;
          }

          const relativePath = rawUrl.replace(/^\/+/, '');
          if (!fs.existsSync(path.join(rootDir, 'public', relativePath))) {
            missingFiles += 1;
          }
        }
      }
    }

    return {
      exists: true,
      studyCount: studies.length,
      instanceCount,
      missingFiles,
    };
  } catch {
    errors.push('public/dicom-manifest.json is not valid JSON.');
    return { exists: true, studyCount: 0, instanceCount: 0, missingFiles: 0 };
  }
}

validateBaseUrl('NEXT_PUBLIC_PACS_API_BASE', pacsApiBase);
validateBaseUrl('NEXT_PUBLIC_DICOM_ASSET_BASE', dicomAssetBase);
validateBaseUrl('AUTH_BACKEND_BASE_URL', authBackendBase);

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
if (nodeMajor !== 24) {
  const message = `Expected Node.js 24.x, received ${process.versions.node}.`;
  (isVercelBuild ? errors : warnings).push(message);
}

const manifest = readManifestStatus();
const hasUsableManifest =
  manifest.exists && manifest.studyCount > 0 && manifest.instanceCount > 0;

if (manifest.missingFiles > 0) {
  errors.push(
    `The local DICOM manifest references ${manifest.missingFiles} missing file(s).`
  );
}

if (isVercelBuild && !pacsApiBase && !hasUsableManifest) {
  if (allowEmptyDataSource) {
    warnings.push(
      'No PACS or demo manifest is configured. ALLOW_EMPTY_DATA_SOURCE is enabled, so only the empty application shell will be deployed.'
    );
  } else {
    errors.push(
      'No deployable data source found. Configure NEXT_PUBLIC_PACS_API_BASE, provide a reviewed non-empty demo manifest, or explicitly set ALLOW_EMPTY_DATA_SOURCE=1 for a UI-only shell deployment; local DICOM data is intentionally excluded from Vercel uploads.'
    );
  }
}

if (!isVercelBuild && !pacsApiBase && !hasUsableManifest) {
  warnings.push(
    'No PACS API or usable local manifest is available; the studies list will be empty.'
  );
}

if (!authBackendBase) {
  warnings.push('AUTH_BACKEND_BASE_URL is unset; the login endpoint is unavailable.');
}

const dataSource = pacsApiBase
  ? 'remote PACS API'
  : manifest.exists
    ? `local manifest (${manifest.studyCount} studies, ${manifest.instanceCount} instances)`
    : allowEmptyDataSource
      ? 'empty application shell (explicitly allowed)'
      : 'none';

console.log(`Deployment readiness: data source = ${dataSource}.`);

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`Error: ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log('Deployment readiness check passed.');
}
