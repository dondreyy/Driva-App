'use client';

import { ApiError, Me } from '@driva/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', vetting_officer: 'VeriQuest officer' };

/** Top bar and the signed in staff member. Sends expired sessions back to sign in. */
export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/login');
      });
  }, [router]);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <MeContext.Provider value={me}>
      <header className="top">
        <Link href="/vetting" className="brand">
          <span className="logo">D</span> Driva Admin
        </Link>
        <div className="row">
          {me ? (
            <span className="who">
              {me.fullName} · {ROLE_LABEL[me.role] ?? me.role}
            </span>
          ) : null}
          <button className="btn ghost" style={{ color: '#fff' }} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="wrap">{children}</main>
    </MeContext.Provider>
  );
}

/** Calls the API and sends the user to sign in if the session has ended. */
export function useUnauthorizedRedirect() {
  const router = useRouter();
  return (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) router.replace('/login');
  };
}
