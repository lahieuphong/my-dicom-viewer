import { NextResponse } from 'next/server';
import { getDicomIndex } from '@/lib/pacs/dicomIndex';

export async function GET() {
  try {
    return NextResponse.json(getDicomIndex(), { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Internal' }, { status: 500 });
  }
}
