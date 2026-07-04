# DICOM Viewer

A web-based DICOM viewer built with Next.js and CornerstoneJS.

## Requirements

- Node.js
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

## Production

```bash
yarn build
yarn start
```

## DICOM Files

Place local `.dcm` files in `public/dicoms/`.

This folder is ignored by Git to avoid committing medical image data.

## Optional Environment

Login proxy support requires:

```bash
AUTH_BACKEND_BASE_URL=https://your-backend-url
```
