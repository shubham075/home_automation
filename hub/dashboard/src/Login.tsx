import { useState, type FormEvent } from 'react';
import { ApiError, login } from './api';

export function Login() {
  const [phone, setPhone] = useState('+91');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(phone, password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Phone number or password is wrong.');
      else if (err instanceof ApiError && err.status === 429) {
        const min = Math.ceil(Number(err.data.retryAfterSec ?? 60) / 60);
        setError(`Too many attempts. Try again in ${min} minute${min === 1 ? '' : 's'}.`);
      } else setError('Cannot reach the hub. Check that it is running and you are on the same Wi-Fi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-4">
      <div className="flex items-center gap-3">
        <img src="/icon.svg" alt="" className="size-10" />
        <div>
          <h1 className="text-xl font-semibold">SW6 Home</h1>
          <p className="text-sm text-slate-500">Sign in to your home hub</p>
        </div>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Phone number
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-accent dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-accent dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
