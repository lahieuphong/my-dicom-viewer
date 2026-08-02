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

See [docs/vercel-deployment.md](docs/vercel-deployment.md) for the required
environment variables, build settings, CORS rules, privacy gates, and the final
pre-deployment checklist.
