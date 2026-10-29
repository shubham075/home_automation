import { useEffect, useState } from 'react';
import { getAccessToken, refreshSession } from './api';
import { Home } from './Home';
import { Login } from './Login';

export function App() {
  // On load the access token is gone (memory only); the refresh cookie restores the session.
  const [state, setState] = useState<'checking' | 'in' | 'out'>('checking');

  useEffect(() => {
    const sync = () => setState(getAccessToken() ? 'in' : 'out');
    window.addEventListener('sw6-auth', sync);
    refreshSession().then((ok) => setState(ok ? 'in' : 'out'));
    return () => window.removeEventListener('sw6-auth', sync);
  }, []);

  if (state === 'checking') return <p className="p-6 text-slate-500">Connecting to your hub…</p>;
  return state === 'in' ? <Home /> : <Login />;
}
