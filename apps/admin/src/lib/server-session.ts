import 'server-only';
import type { AuthTokens } from '@driva/shared';
import { cookies } from 'next/headers';

/** The API, reached from the dashboard's server. Browsers never call it with tokens. */
export const API_URL = (process.env.DRIVA_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const ACCESS = 'driva_admin_access';
const REFRESH = 'driva_admin_refresh';

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS, tokens.accessToken, { ...cookieOptions, maxAge: tokens.expiresIn });
  // Staff sessions last at most 12 hours, shorter than the app's 30 day refresh token.
  jar.set(REFRESH, tokens.refreshToken, { ...cookieOptions, maxAge: 12 * 60 * 60 });
}

export async function clearTokens(): Promise<string | undefined> {
  const jar = await cookies();
  const refresh = jar.get(REFRESH)?.value;
  jar.delete(ACCESS);
  jar.delete(REFRESH);
  return refresh;
}

export async function accessToken(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS)?.value;
}

/** Swaps the refresh cookie for new tokens. Returns the new access token, or null. */
export async function refreshTokens(): Promise<string | null> {
  const refreshToken = (await cookies()).get(REFRESH)?.value;
  if (!refreshToken) return null;
  const res = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  if (!res.ok) {
    await clearTokens();
    return null;
  }
  const tokens = (await res.json()) as AuthTokens;
  await saveTokens(tokens);
  return tokens.accessToken;
}

export function passThrough(res: Response, body: string): Response {
  return new Response(body || null, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
  });
}
