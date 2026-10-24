import type { VerifyResult } from '@driva/shared';
import { API_URL, passThrough, saveTokens } from '@/lib/server-session';

/** Signs staff in and keeps the tokens in httpOnly cookies. Only the profile goes to the browser. */
export async function POST(req: Request): Promise<Response> {
  const { phone, code } = (await req.json()) as { phone?: string; code?: string };
  const res = await fetch(`${API_URL}/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code, app: 'admin' }),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) return passThrough(res, text);
  const result = JSON.parse(text) as VerifyResult;
  if (result.status !== 'signed_in') {
    return Response.json(
      { message: 'There is no staff account for this number.' },
      { status: 403 },
    );
  }
  await saveTokens(result);
  return Response.json({ user: result.user });
}
