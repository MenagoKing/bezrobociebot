import { useState } from 'react';
import { api } from '../api.ts';

export function Login({ status, onDone }: { status: { setupRequired: boolean; setupAllowed: boolean }; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = status.setupRequired;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup && password !== repeat) return setError('Hasła nie są identyczne');
    setBusy(true);
    try {
      await api.post(setup ? '/api/auth/setup' : '/api/auth/login', { password });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-logo">◎</div>SolDesk
        </div>
        {setup ? (
          status.setupAllowed ? (
            <>
              <div className="muted">Pierwsze uruchomienie — ustaw hasło administratora (min. 10 znaków).</div>
              <input type="password" placeholder="Nowe hasło" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              <input type="password" placeholder="Powtórz hasło" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            </>
          ) : (
            <div className="warn-box">Hasło administratora nie jest ustawione. Ustaw zmienną ADMIN_PASSWORD w pliku .env na serwerze albo otwórz panel lokalnie (localhost).</div>
          )
        ) : (
          <>
            <div className="muted">Zaloguj się do panelu.</div>
            <input type="password" placeholder="Hasło" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </>
        )}
        {error && <div className="err-box">{error}</div>}
        {(!setup || status.setupAllowed) && (
          <button className="btn btn-primary btn-lg" disabled={busy || !password}>
            {busy ? '…' : setup ? 'Ustaw hasło i zaloguj' : 'Zaloguj'}
          </button>
        )}
      </form>
    </div>
  );
}
