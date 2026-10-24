import { API_URL, clearTokens } from '@/lib/server-session';

export async function POST(): Promise<Response> {
  const refreshToken = await clearTokens();
  if (refreshToken) {
    await fetch(`${API_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => undefined);
  }
  return new Response(null, { status: 204 });
}
