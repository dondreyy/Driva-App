'use client';

import { createApiClient } from '@driva/shared';

/** The shared API client, pointed at the dashboard's own proxy. Cookies carry the session. */
export const api = createApiClient({
  baseUrl: '/api/proxy',
  fetch: (url, init) =>
    fetch(url.replace('/api/proxy/v1/', '/api/proxy/'), { ...init, credentials: 'same-origin' }),
});

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Try again.';
}
