import React, { useState } from 'react';

const API = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export default function AdminLogin({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || 'Login failed');
      }
      const { token } = await res.json();
      onLogin(token);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-shell">
      <div className="admin-login-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 22 }}>↩</span>
          <div>
            <h1>Admin Portal</h1>
            <div className="sub" style={{ margin: 0 }}>Loopp Refund Agent</div>
          </div>
        </div>

        {error && <div className="login-error">⚠️ {error}</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              placeholder="Enter admin password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading || !password}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div style={{ marginTop: 20, padding: '12px 14px', background: 'var(--bg-input)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
          Customer support chat is available at <a href="/" style={{ color: 'var(--accent)' }}>the home page</a>.
        </div>
      </div>
    </div>
  );
}
