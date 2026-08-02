import { NextResponse } from 'next/server';
import { getStudySummary } from '@/server/dicom-manifest';
import { PRIVATE_NO_STORE_HEADERS } from '@/server/http';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ studyUID: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { studyUID } = await context.params;
    const study = getStudySummary(studyUID);

    if (!study) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404, headers: PRIVATE_NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(study, {
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
