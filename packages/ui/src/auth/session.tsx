import { ApiClient, ApiError, AuthTokens, createApiClient, Me } from '@driva/shared';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { TokenStorage } from './storage';

type Status = 'loading' | 'signed_out' | 'signed_in';

interface SessionValue {
  status: Status;
  user: Me | null;
  /** API client that sends the access token and refreshes it once when it has expired. */
  api: ApiClient;
  signIn(result: AuthTokens & { user: Me }): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  baseUrl,
  storage,
  children,
}: {
  baseUrl: string;
  storage: TokenStorage;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<Me | null>(null);
  const accessToken = useRef<string | null>(null);
  const refreshing = useRef<Promise<boolean> | null>(null);

  const plain = useMemo(() => createApiClient({ baseUrl }), [baseUrl]);

  /** Swaps the stored refresh token for new tokens. Only one refresh runs at a time. */
  const refresh = useCallback((): Promise<boolean> => {
    refreshing.current ??= (async () => {
      try {
        const refreshToken = await storage.get();
        if (!refreshToken) return false;
        const tokens = await plain.refresh({ refreshToken });
        await storage.set(tokens.refreshToken);
        accessToken.current = tokens.accessToken;
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) await storage.remove();
        return false;
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, [plain, storage]);

  const api = useMemo(() => {
    const authed = createApiClient({ baseUrl, getAccessToken: () => accessToken.current });
    const retrying = {} as ApiClient;
    for (const key of Object.keys(authed) as (keyof ApiClient)[]) {
      const call = authed[key] as (...args: unknown[]) => Promise<unknown>;
      (retrying as Record<string, unknown>)[key] = async (...args: unknown[]) => {
        try {
          return await call(...args);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 401) || !(await refresh())) throw err;
          return call(...args);
        }
      };
    }
    return retrying;
  }, [baseUrl, refresh]);

  // On launch, resume the last session if the refresh token is still good.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resumed = (await refresh()) ? await api.me().catch(() => null) : null;
      if (cancelled) return;
      setUser(resumed);
      setStatus(resumed ? 'signed_in' : 'signed_out');
    })();
    return () => {
      cancelled = true;
    };
  }, [api, refresh]);

  const signIn = useCallback(
    async (result: AuthTokens & { user: Me }) => {
      await storage.set(result.refreshToken);
      accessToken.current = result.accessToken;
      setUser(result.user);
      setStatus('signed_in');
    },
    [storage],
  );

  const signOut = useCallback(async () => {
    const refreshToken = await storage.get();
    await storage.remove();
    accessToken.current = null;
    setUser(null);
    setStatus('signed_out');
    if (refreshToken) await plain.logout({ refreshToken }).catch(() => undefined);
  }, [plain, storage]);

  const value = useMemo(
    () => ({ status, user, api, signIn, signOut }),
    [status, user, api, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
