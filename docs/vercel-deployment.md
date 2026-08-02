# Vercel deployment readiness

## Current deployment model

Vercel can build and run this Next.js application, including its Node.js route
handlers and Cornerstone worker/WASM assets. Production data is the important
boundary:

- `public/dicoms/` and `public/dicom-manifest.json` are local-development data.
  They are intentionally excluded from Git and Vercel CLI uploads.
- A normal Git-based Vercel deployment must use a remote PACS/data API.
- Do not force-add clinical DICOM files or a manifest containing patient fields
  to Git. Files under `public/` are anonymous static assets.

The build runs `yarn check:deploy` automatically. On Vercel it fails early when
neither a remote API nor a deployable local manifest is available, instead of
shipping an application that silently displays zero studies.

## Vercel project settings

Use the detected Next.js preset with these values:

| Setting | Value |
| --- | --- |
| Root directory | repository root |
| Install command | `yarn install --frozen-lockfile` |
| Build command | `yarn build` |
| Output directory | leave at the Next.js default |
| Node.js | `24.x` |

A `vercel.json` file is not needed for this application. Next.js routes and
functions are detected automatically.

## Environment variables

Configure variables separately for Preview and Production:

| Variable | Visibility | Requirement |
| --- | --- | --- |
| `NEXT_PUBLIC_PACS_API_BASE` | public/build-time | Required for the recommended remote deployment; must be an absolute HTTPS URL. |
| `NEXT_PUBLIC_DICOM_ASSET_BASE` | public/build-time | Optional base for relative instance URLs. Prefer absolute signed URLs instead. |
| `AUTH_BACKEND_BASE_URL` | server-only/runtime | Required only when the current login proxy is enabled; must be reachable from Vercel over HTTPS. |

Never place credentials, API keys, or bearer tokens in a `NEXT_PUBLIC_*`
variable. These values are embedded in browser JavaScript, and changes only
apply after a new build/deployment.

## Remote API contract

With `NEXT_PUBLIC_PACS_API_BASE=https://pacs.example.com/api`, the browser calls:

```text
GET https://pacs.example.com/api/studies
GET https://pacs.example.com/api/studies/:studyUID
GET https://pacs.example.com/api/studies/:studyUID/series
```

Instance references may be:

- absolute HTTPS URLs (recommended, ideally short-lived signed URLs);
- root-relative paths resolved against the configured DICOM/PACS origin;
- path-relative values resolved against the configured base path; or
- existing Cornerstone IDs such as `wadouri:` and `wadors:`.

Because metadata and pixels are fetched by the browser, the PACS/storage service
must allow the exact Production origin and every intended Preview origin. Test
CORS preflight, range requests, signed query strings, and the headers required by
the DICOM loader. HTTP endpoints will be blocked as mixed content from Vercel's
HTTPS site.

Do not proxy large DICOM binaries through an ordinary Vercel Function. Serve
them directly from an authorized PACS or private object storage using signed
URLs. Large study/series catalogs should also be paginated instead of returning
the complete clinical index in one response.

## Security and clinical-data release gate

The current login flow stores the upstream token in `localStorage`; it is not yet
a production authorization boundary. Before any real patient data is connected:

1. Replace it with a server-managed session using `HttpOnly`, `Secure`, and
   appropriate `SameSite` cookies.
2. Authorize every study, series, and pixel request on the server/PACS side.
3. Keep protected DICOM objects outside `public/`; use authorized or short-lived
   signed URLs.
4. Complete the organization's security/privacy review, Vercel plan and BAA or
   other required contractual approval, region/log-retention policy, RBAC,
   auditing, incident response, and data-retention controls.
5. Avoid patient identifiers in query strings. They can enter browser history,
   referrers, analytics, and platform access logs.

The application now sends `private, no-store` for its local medical metadata
APIs and a strict `no-referrer` policy, but these headers do not replace access
control.

## Pre-deployment verification

Run with Node.js 24:

```bash
yarn install --frozen-lockfile
yarn check:deploy
yarn verify
yarn build
```

Then test a production server or Preview deployment:

1. `/studies` loads metadata from the configured source and shows a visible
   error when the source is unavailable.
2. A study opens through `/viewer?StudyInstanceUIDs=...`.
3. The Cornerstone worker and every emitted `.wasm` decoder return HTTP 200;
   WASM responses use `Content-Type: application/wasm`.
4. Absolute, root-relative, path-relative, signed, `wadouri:`, and `wadors:`
   instance references load correctly.
5. Production and Preview CORS, preflight, range requests, and HTTPS certificates
   work from a clean browser profile.
6. Unauthorized metadata and pixel requests are rejected before real data is
   enabled.
7. Logout followed by another login does not expose the previous user's cached
   metadata.
8. API responses containing medical metadata include
   `Cache-Control: private, no-store`.
