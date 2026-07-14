import { NextResponse } from 'next/server';
import { getSeriesForStudy } from '@/server/dicom-manifest';

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
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal' }, { status: 500 });
  }
}
