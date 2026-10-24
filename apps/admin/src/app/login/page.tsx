'use client';

import { formatNigerianPhone, normalizeNigerianPhone, OTP_LENGTH } from '@driva/shared';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (!res.ok) {
    throw new Error(
      Array.isArray(data.message)
        ? data.message.join('. ')
        : (data.message ?? 'Something went wrong.'),
    );
  }
  return data;
}

export default function Login() {
  const router = useRouter();
  const [phone, setPhone] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!phone) {
        const normalized = normalizeNigerianPhone(input);
        if (!normalized) throw new Error('Enter a Nigerian mobile number.');
        await post('/api/auth/otp/request', { phone: normalized });
        setPhone(normalized);
      } else {
        await post('/api/auth/otp/verify', { phone, code });
        router.replace('/vetting');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="brand" style={{ marginBottom: 24 }}>
        <span className="logo">D</span> Driva Admin
      </div>
      <form className="card" onSubmit={submit}>
        <h1 style={{ fontSize: 26 }}>{phone ? 'Enter the code' : 'Staff sign in'}</h1>
        <p className="muted">
          {phone
            ? `We sent a ${OTP_LENGTH} digit code to ${formatNigerianPhone(phone)}.`
            : 'For Driva admins and VeriQuest officers.'}
        </p>
        {error ? (
          <div className="error" role="alert">
            {error}
          </div>
        ) : null}
        {phone ? (
          <div className="field">
            <label htmlFor="code">Code</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={OTP_LENGTH}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="phone">Phone number</label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="0803 000 0000"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
            />
          </div>
        )}
        <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
          {phone ? 'Sign in' : 'Send code'}
        </button>
      </form>
    </main>
  );
}
