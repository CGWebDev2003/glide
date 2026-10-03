import { picker } from '@/lib/server/picker';
import { errorResponse, json } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Opens a live preview of the page for choosing elements. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { config?: Record<string, unknown> };
    if (!body.config || typeof body.config !== 'object') return json({ error: 'config fehlt' }, 400);
    return json(await picker.open(body.config), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
