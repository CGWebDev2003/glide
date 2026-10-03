import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { jobs } from '@/lib/server/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Streams a finished video with HTTP Range support (seeking in <video>). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = await jobs.get((await params).id);
  const file = job && job.status === 'done' ? jobs.videoPath(job) : null;
  if (!job || !file) return new Response('not found', { status: 404 });
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return new Response('video file missing', { status: 410 });
  }
  const type = file.endsWith('.webm') ? 'video/webm' : 'video/mp4';
  const headers: Record<string, string> = { 'content-type': type, 'accept-ranges': 'bytes' };
  if (new URL(req.url).searchParams.has('download')) {
    headers['content-disposition'] = `attachment; filename="${job.file}"`;
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    let start: number;
    let end: number;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    } else {
      start = Math.max(0, size - Number(range[2]));
      end = size - 1;
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(body, { headers: { ...headers, 'content-length': String(size) } });
}
