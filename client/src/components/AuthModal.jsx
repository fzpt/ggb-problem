import { useState } from 'react';
import { useApp } from '../store/AppContext';
import * as api from '../services/api';

export default function AuthModal() {
  const { onAuth } = useApp();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.includes('@') || password.length < 6) {
      setError('请输入有效邮箱和至少 6 位密码');
      return;
    }
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await api.login(email, password)
        : await api.register(email, password);
      onAuth(res.user);
    } catch (e) {
      setError(e.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-head">
          <h2>{mode === 'login' ? '登录' : '注册'}</h2>
        </div>
        <div className="modal-body">
          <form onSubmit={submit} className="flex flex-col gap-2">
            <div className="name-row">
              <label htmlFor="auth-email">邮箱</label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                required
              />
            </div>
            <div className="name-row">
              <label htmlFor="auth-password">密码</label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="至少 6 位"
                required
              />
            </div>
            {error && <p className="log" style={{ marginTop: '0.5rem' }}>{error}</p>}
            <button className="primary" type="submit" disabled={loading} style={{ marginTop: '0.5rem' }}>
              {loading ? '请稍候...' : (mode === 'login' ? '登录' : '注册并登录')}
            </button>
          </form>
          <p className="hint" style={{ marginTop: '1rem', textAlign: 'center' }}>
            {mode === 'login' ? '还没有账号？' : '已有账号？'}
            <button
              type="button"
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
              style={{ marginLeft: '0.25rem', padding: 0, border: 'none', background: 'none', color: 'var(--ink)', textDecoration: 'underline' }}
            >
              {mode === 'login' ? '去注册' : '去登录'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
