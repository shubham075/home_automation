import { useState, type FormEvent } from 'react';
import { ApiError, acceptInvite, login } from './api';

const input =
  'rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-accent dark:border-slate-700 dark:bg-slate-900';

const INVITE_ERRORS: Record<string, string> = {
  invalid_code: 'That code does not match an open invite for this phone number. Check both, or ask for a new invite.',
  wrong_password: 'This phone number already has an account. Enter that account’s password.',
  name_required: 'Enter your name to create your account.',
  too_many_attempts: 'Too many attempts. Wait a few minutes and try again.',
  invalid_body: 'Check the fields: phone like +919812345678, a 6-digit code, and a password of at least 8 characters.',
};

export function Login() {
  const [mode, setMode] = useState<'login' | 'invite'>('login');
  const [phone, setPhone] = useState('+91');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(phone, password);
      else await acceptInvite({ phone, code, name: name.trim() || undefined, password });
    } catch (err) {
      if (!(err instanceof ApiError)) setError('Cannot reach the hub. Check that it is running and you are on the same Wi-Fi.');
      else if (mode === 'invite') setError(INVITE_ERRORS[err.code] ?? 'Could not join. Try again.');
      else if (err.status === 401) setError('Phone number or password is wrong.');
      else if (err.status === 429) {
        const min = Math.ceil(Number(err.data.retryAfterSec ?? 60) / 60);
        setError(`Too many attempts. Try again in ${min} minute${min === 1 ? '' : 's'}.`);
      } else setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const switchTo = (m: 'login' | 'invite') => {
    setMode(m);
    setError(null);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-4">
      <div className="flex items-center gap-3">
        <img src="/icon.svg" alt="" className="size-10" />
        <div>
          <h1 className="text-xl font-semibold">SW6 Home</h1>
          <p className="text-sm text-slate-500">{mode === 'login' ? 'Sign in to your home hub' : 'Join a home with an invite code'}</p>
        </div>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Phone number
          <input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={input} />
        </label>
        {mode === 'invite' && (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Invite code
              <input id="invite-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 digits" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className={`${input} font-mono tracking-[0.3em]`} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Your name
              <input id="invite-name" autoComplete="name" placeholder="Not needed if you already have an account" value={name} onChange={(e) => setName(e.target.value)} className={input} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium">
          {mode === 'login' ? 'Password' : 'Password (new, or your existing one)'}
          <input
            id="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
          />
        </label>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-white disabled:opacity-60">
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Join home'}
        </button>
        <button type="button" onClick={() => switchTo(mode === 'login' ? 'invite' : 'login')} className="text-sm text-slate-500 underline-offset-4 hover:underline">
          {mode === 'login' ? 'I have an invite code' : 'I already belong to this home – sign in'}
        </button>
      </form>
    </main>
  );
}
