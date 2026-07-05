import { NextResponse } from 'next/server';
import { getSeriesForStudy } from '@/lib/pacs/dicomIndex';

type RouteContext = {
  params: Promise<{ studyUID: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { studyUID } = await context.params;
    return NextResponse.json(getSeriesForStudy(studyUID), {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal' }, { status: 500 });
  }
}
