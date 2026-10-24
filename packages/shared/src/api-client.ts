import type {
  AuthTokens,
  Me,
  OtpRequest,
  OtpVerify,
  RefreshRequest,
  SignupRequest,
  SignupResult,
  UpdateMeRequest,
  VerifyResult,
} from './auth';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  /** Returns the current access token, if signed in. */
  getAccessToken?: () => string | null | undefined;
}

/** Typed client for the Driva API, shared by the client and driver apps. */
export function createApiClient(options: ApiClientOptions) {
  const doFetch: FetchLike =
    options.fetch ?? ((globalThis as { fetch?: unknown }).fetch as FetchLike);
  const base = options.baseUrl.replace(/\/$/, '');

  async function call<T>(method: string, path: string, body?: unknown, auth = false): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = options.getAccessToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await doFetch(`${base}/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
    if (!res.ok) throw new ApiError(res.status, errorMessage(data));
    return data as T;
  }

  return {
    requestOtp: (body: OtpRequest) =>
      call<{ expiresIn: number }>('POST', '/auth/otp/request', body),
    verifyOtp: (body: OtpVerify) => call<VerifyResult>('POST', '/auth/otp/verify', body),
    signup: (body: SignupRequest) => call<SignupResult>('POST', '/auth/signup', body),
    refresh: (body: RefreshRequest) => call<AuthTokens>('POST', '/auth/refresh', body),
    logout: (body: RefreshRequest) => call<void>('POST', '/auth/logout', body),
    me: () => call<Me>('GET', '/me', undefined, true),
    updateMe: (body: UpdateMeRequest) => call<Me>('PATCH', '/me', body, true),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

function errorMessage(data: unknown): string {
  const message = (data as { message?: unknown } | undefined)?.message;
  if (Array.isArray(message)) return message.join('. ');
  if (typeof message === 'string') return message;
  return 'Something went wrong. Please try again.';
}
