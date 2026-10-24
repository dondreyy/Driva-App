import { NextRequest } from 'next/server';
import { API_URL } from '@/lib/server-session';

/**
 * Passes signed photo links through to the API when it serves files itself (development and
 * the Docker demo, where links are relative). The signed token is the only credential.
 * With S3 in production, links point at S3 and this route is not used.
 */
async function forward(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const res = await fetch(`${API_URL}/v1/files/${encodeURIComponent(token)}`, {
    method: req.method,
    headers: req.method === 'PUT' ? { 'Content-Type': req.headers.get('content-type') ?? '' } : {},
    body: req.method === 'PUT' ? await req.arrayBuffer() : undefined,
    cache: 'no-store',
  });
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'private, no-store',
    },
  });
}

export { forward as GET, forward as PUT };
