import { NextRequest } from 'next/server';
import { accessToken, API_URL, passThrough, refreshTokens } from '@/lib/server-session';

/** Only these API areas are reachable from the dashboard. */
const ALLOWED = /^(admin\/|me$)/;

/**
 * Forwards a dashboard request to the API with the staff member's access token from the
 * httpOnly cookie, refreshing it once if it has expired.
 */
async function forward(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const path = (await ctx.params).path.join('/');
  if (!ALLOWED.test(path)) return Response.json({ message: 'Not found' }, { status: 404 });
  if (req.method !== 'GET' && req.headers.get('content-type') !== 'application/json') {
    // Blocks plain HTML form posts from other sites.
    return Response.json({ message: 'Send JSON' }, { status: 415 });
  }
  const body = req.method === 'GET' ? undefined : await req.text();

  const send = (token: string | undefined | null) =>
    fetch(`${API_URL}/v1/${path}${req.nextUrl.search}`, {
      method: req.method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      cache: 'no-store',
    });

  let res = await send(await accessToken());
  if (res.status === 401) {
    const fresh = await refreshTokens();
    if (fresh) res = await send(fresh);
  }
  return passThrough(res, await res.text());
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH };
