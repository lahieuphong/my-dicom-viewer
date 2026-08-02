import { NextResponse } from 'next/server';
import { getSeriesForStudy } from '@/server/dicom-manifest';
import { PRIVATE_NO_STORE_HEADERS } from '@/server/http';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ studyUID: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { studyUID } = await context.params;
    const { searchParams } = new URL(request.url);
    const includeInstances = searchParams.get('includeInstances') !== 'false';

    return NextResponse.json(getSeriesForStudy(studyUID, { includeInstances }), {
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
