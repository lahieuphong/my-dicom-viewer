import { NextResponse } from 'next/server';
import { getStudySummaries } from '@/lib/pacs/dicomIndex';

export async function GET() {
  try {
    return NextResponse.json(getStudySummaries(), {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal' }, { status: 500 });
  }
}
