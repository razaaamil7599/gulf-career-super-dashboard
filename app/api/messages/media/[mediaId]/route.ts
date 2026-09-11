import { NextRequest, NextResponse } from 'next/server';

// Route Handlers in App Router use Web Request/Response APIs.
const { fetchMediaAsset } = require('../../../../../server/services/whatsappService');

export const dynamic = 'force-dynamic';

function getDisposition(mimeType: string, fileName: string) {
  const lower = String(mimeType || '').toLowerCase();
  if (
    lower.startsWith('image/')
    || lower.startsWith('audio/')
    || lower.startsWith('video/')
    || lower.includes('pdf')
  ) {
    return `inline; filename="${fileName}"`;
  }
  return `attachment; filename="${fileName}"`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params;
    if (!mediaId) {
      return NextResponse.json({ error: 'MEDIA_ID_REQUIRED' }, { status: 400 });
    }

    const asset = await fetchMediaAsset(mediaId);
    const fileName = asset.fileName || `media-${mediaId}`;

    return new NextResponse(asset.buffer, {
      headers: {
        'Content-Type': asset.mimeType || 'application/octet-stream',
        'Content-Disposition': getDisposition(asset.mimeType, fileName),
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error: any) {
    console.error('[Media Route] Failed to fetch media:', error.message);
    return NextResponse.json({ error: 'MEDIA_FETCH_FAILED' }, { status: 502 });
  }
}
