import { json } from '@/lib/server/http';
import { loadCore } from '@/lib/server/core';
import { dataDir, videosDir } from '@/lib/server/paths';
import type { SystemStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { checkFfmpeg, browserStatus } = await loadCore();
  const status: SystemStatus = { ffmpeg: { ok: true }, chromium: browserStatus(), dataDir, videosDir };
  try {
    await checkFfmpeg('libx264');
  } catch (e) {
    status.ffmpeg = { ok: false, message: (e as Error).message };
  }
  return json(status);
}
