import { useEffect, useState } from 'react';
import { getToken } from './api';
import { Home } from './Home';
import { Login } from './Login';

export function App() {
  const [token, setTokenState] = useState(getToken);

  useEffect(() => {
    const sync = () => setTokenState(getToken());
    window.addEventListener('sw6-auth', sync);
    return () => window.removeEventListener('sw6-auth', sync);
  }, []);

  return token ? <Home /> : <Login />;
}
