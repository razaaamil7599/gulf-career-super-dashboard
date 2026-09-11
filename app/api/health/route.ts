import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'NEXTJS_API_OK' });
}
