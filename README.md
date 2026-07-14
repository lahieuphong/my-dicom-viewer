# DICOM Viewer

A web-based DICOM viewer built with Next.js and CornerstoneJS.

## Requirements

- Node.js 22 LTS
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
