/**
 * Sign in / sign up page with tabbed forms. On success the AuthContext
 * stores the JWT and we route back to where the user came from (or home).
 */
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';

type Tab = 'login' | 'register';

export function AuthPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [country, setCountry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tab === 'login') {
        await login(identifier.trim(), password);
        toast.push('Welcome back!');
      } else {
        await register({
          username: username.trim(),
          email: email.trim(),
          password,
          country: country.trim() || undefined,
        });
        toast.push('Account created — let the beats begin!');
      }
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="page-title" style={{ marginBottom: 4 }}>
          {tab === 'login' ? 'Welcome back' : 'Join BeatSync'}
        </h1>
        <p className="page-sub">Type to the beat. Level up. Climb the ranks.</p>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            className={tab === 'login' ? 'active' : ''}
            onClick={() => setTab('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'register'}
            className={tab === 'register' ? 'active' : ''}
            onClick={() => setTab('register')}
          >
            Create account
          </button>
        </div>

        {error ? <div className="form-error">{error}</div> : null}

        <form onSubmit={submit}>
          {tab === 'login' ? (
            <div className="field">
              <label htmlFor="identifier">Username or email</label>
              <input
                id="identifier"
                className="input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  minLength={3}
                  maxLength={24}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="country">Country (optional — for country leaderboards)</label>
                <input
                  id="country"
                  className="input"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  maxLength={56}
                  placeholder="e.g. India"
                />
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
            {busy ? <span className="spinner" /> : tab === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="muted small" style={{ marginTop: 14 }}>
          {tab === 'login' ? 'New here? ' : 'Already have an account? '}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setTab(tab === 'login' ? 'register' : 'login')}
          >
            {tab === 'login' ? 'Create an account' : 'Sign in instead'}
          </button>
        </p>
      </div>
    </div>
  );
}
