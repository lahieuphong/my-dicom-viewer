import { NextResponse } from 'next/server';
import { getStudySummaries } from '@/server/dicom-manifest';
import { PRIVATE_NO_STORE_HEADERS } from '@/server/http';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(getStudySummaries(), {
      status: 200,
      headers: PRIVATE_NO_STORE_HEADERS,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal' },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
}
