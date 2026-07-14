import { NextResponse } from 'next/server';
import { getStudySummary } from '@/server/dicom-manifest';

type RouteContext = {
  params: Promise<{ studyUID: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { studyUID } = await context.params;
    const study = getStudySummary(studyUID);

    if (!study) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(study, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal' }, { status: 500 });
  }
}
