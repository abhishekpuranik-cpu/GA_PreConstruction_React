import { useEffect, useState } from 'react';
import { fetchLoginUser } from './preconSession.js';

export function useLoginUser() {
  const [login, setLogin] = useState({ ready: false, authenticated: false, name: '', email: '' });

  useEffect(() => {
    let alive = true;
    (async () => {
      const u = await fetchLoginUser();
      if (alive) setLogin(u);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return login;
}
