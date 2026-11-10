# DICOM Viewer

A web-based DICOM viewer built with Next.js and CornerstoneJS.

## Requirements

- Node.js 24 LTS
- Yarn 1.x

## Install

```bash
yarn install
```

## Development

```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Before committing structural changes, run:

```bash
yarn verify
```

Browser regressions drive the real viewer through the Chrome DevTools
Protocol. One command runs all of them, reusing a viewer on
`VIEWER_ORIGIN` (default `http://127.0.0.1:3000`) and a Chrome exposing
`CDP_ORIGIN` (default `http://127.0.0.1:9222`), or starting `next dev` and a
headless Chrome itself (`CHROME_PATH` overrides the Chrome binary):

```bash
yarn test:cdp                         # all regressions
yarn test:cdp --only resize,sr-tools  # a subset; --list shows the names
yarn test:cdp --gpu                   # Chrome on the hardware GPU
```

The started Chrome uses SwiftShader (software WebGL) by default so the suite
also runs without a GPU, e.g. in CI. `--gpu` is about three times faster and
closer to what users run; timing races that the slow SwiftShader path hides
show up there, so run both before relying on a viewer change.

GitHub Actions (`.github/workflows/ci.yml`) runs `yarn verify`, the production
build and `yarn test:cdp` with SwiftShader on every push to `main` and every
pull request; failing regression logs are uploaded as the `cdp-logs` artifact.

Before a production/Vercel build, run:

```bash
yarn check:deploy
yarn build
```

The project follows a compatibility-first `platform / extensions / modes`
architecture. See [docs/architecture.md](docs/architecture.md) for dependency
rules and the migration roadmap.

## Production

```bash
yarn build
yarn start
```

## DICOM Files

Place local `.dcm` files in `public/dicoms/`.

This folder is ignored by Git to avoid committing medical image data.

For local sample data, generate the static metadata manifest before running the
viewer:

```bash
yarn dicom:manifest
```

Runtime API routes read `public/dicom-manifest.json` only; they do not parse DICOM
files on each request. For real data, keep the frontend DTO shape and point the
client at your PACS/backend with:

```bash
NEXT_PUBLIC_PACS_API_BASE=https://your-backend.example/api
```

Relative DICOM instance URLs can be resolved against a separate HTTPS asset
origin:

```bash
NEXT_PUBLIC_DICOM_ASSET_BASE=https://your-dicom-storage.example
```

Prefer absolute, short-lived signed HTTPS instance URLs from the backend. Both
`NEXT_PUBLIC_*` values are public and embedded in the client bundle at build
time; changing them requires a rebuild.

Expected remote endpoints:

```txt
GET /studies
GET /studies/:studyUID
GET /studies/:studyUID/series
```

Series instances may carry optional patient-space geometry, as the generated
manifest does: `imagePositionPatient`, `imageOrientationPatient` and
`frameOfReferenceUID`. Image Slice Sync uses it to place slices of a series
whose files have not been loaded yet; without it, only loaded slices can be
matched.

## Optional Environment

Login proxy support requires:

```bash
AUTH_BACKEND_BASE_URL=https://your-backend-url
```

## Vercel

Local DICOM files and their manifest are intentionally excluded from Git and
Vercel CLI uploads. A Vercel deployment therefore needs a remote PACS/data API
unless a separately reviewed, de-identified demo dataset is supplied through a
controlled build process.

For a UI-only smoke deployment before a PACS is available, explicitly set
`ALLOW_EMPTY_DATA_SOURCE=1` in the target Vercel environment. This deploys an
empty application shell and never includes local DICOM files; it is not a
clinical-production data mode.

See [docs/vercel-deployment.md](docs/vercel-deployment.md) for the required
environment variables, build settings, CORS rules, privacy gates, and the final
pre-deployment checklist.
