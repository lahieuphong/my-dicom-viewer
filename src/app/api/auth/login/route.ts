import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

import { PRIVATE_NO_STORE_HEADERS } from '@/server/http';

export const runtime = 'nodejs';
export const maxDuration = 15;

const MAX_REQUEST_BYTES = 8 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;
const AUTH_PATH = 'api/HVTT/HPT/Authencation/clientAuthenticate';

type LoginBody = Record<string, unknown> & {
  UserID?: unknown;
  Password?: unknown;
};

function json(data: unknown, status: number) {
  return NextResponse.json(data, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function isLoopback(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function getBackendUrl(): URL | null {
  const rawBase = process.env.AUTH_BACKEND_BASE_URL?.trim();
  if (!rawBase) return null;

  try {
    const baseUrl = new URL(rawBase.endsWith('/') ? rawBase : `${rawBase}/`);
    const isLocalHttp =
      process.env.VERCEL !== '1' &&
      baseUrl.protocol === 'http:' &&
      isLoopback(baseUrl.hostname);

    if (
      (baseUrl.protocol !== 'https:' && !isLocalHttp) ||
      (process.env.VERCEL === '1' && isLoopback(baseUrl.hostname))
    ) {
      return null;
    }
    if (
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      return null;
    }
    return new URL(AUTH_PATH, baseUrl);
  } catch {
    return null;
  }
}

async function readLoginBody(request: Request): Promise<LoginBody | null> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) return null;

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new RangeError('Request body is too large');
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    throw new RangeError('Request body is too large');
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as LoginBody;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return json(
      { result: -1, data: 'Authentication service is unavailable' },
      503
    );
  }

  let body: LoginBody | null;
  try {
    body = await readLoginBody(request);
  } catch (error) {
    if (error instanceof RangeError) {
      return json({ result: -1, data: 'Request body is too large' }, 413);
    }
    return json({ result: -1, data: 'Invalid request body' }, 400);
  }

  const userId = typeof body?.UserID === 'string' ? body.UserID.trim() : '';
  const password = typeof body?.Password === 'string' ? body.Password : '';

  if (
    !body ||
    !userId ||
    !password ||
    userId.length > 256 ||
    password.length > 4096
  ) {
    return json({ result: -1, data: 'Invalid credentials payload' }, 400);
  }

  // MD5 is retained solely for compatibility with the existing upstream
  // protocol. TLS remains mandatory; this is not a password-storage strategy.
  const passwordMd5 = crypto.createHash('md5').update(password).digest('hex');

  try {
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UserID: userId, Password: passwordMd5 }),
      cache: 'no-store',
      // Never forward credentials across an unvalidated redirect (including an
      // HTTPS-to-HTTP downgrade). The configured endpoint must answer directly.
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const rawResponse = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(rawResponse);
    } catch {
      console.error('[auth/login] Upstream returned a non-JSON response.');
      return json({ result: -1, data: 'Authentication service error' }, 502);
    }

    return json(data, response.status);
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');

    console.error(
      `[auth/login] Upstream request failed (${isTimeout ? 'timeout' : 'network'}).`
    );

    return json(
      {
        result: -1,
        data: isTimeout
          ? 'Authentication service timed out'
          : 'Authentication service is unreachable',
      },
      isTimeout ? 504 : 502
    );
  }
}
