import { API_URL, passThrough } from '@/lib/server-session';

export async function POST(req: Request): Promise<Response> {
  const res = await fetch(`${API_URL}/v1/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await req.text(),
    cache: 'no-store',
  });
  return passThrough(res, await res.text());
}
