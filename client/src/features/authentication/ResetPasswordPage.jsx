import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authAPI } from '../../services/api';
import { Input } from '../../components/forms/Input';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reset, setReset] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await authAPI.resetPassword({ token, password, confirmPassword });
      setReset(true);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not reset your password. Request a new reset link.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div>
          <img className="auth-logo" src="/reo.png" alt="" />
          <h1>REO Travel Academy</h1>
          <p>Choose a new password to continue your learning journey.</p>
        </div>
        <p style={{ marginTop: 'auto', opacity: 0.8, fontSize: 13 }}>© 2026 Reo Travel Academy. All rights reserved.</p>
      </aside>
      <div className="auth-form-wrap">
        <div className="auth-card">
          <h2>Choose a new password</h2>
          <p className="subtitle">Use at least 8 characters. Your reset link expires after one hour.</p>
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {!token ? (
            <div className="notice notice-error" role="alert">This reset link is invalid. Request a new one to continue.</div>
          ) : reset ? (
            <div className="notice" role="status">
              Your password has been updated. <Link to="/login">Sign in</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <Input
                label="New password"
                type="password"
                name="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                value={password}
                onChange={setPassword}
              />
              <Input
                label="Confirm new password"
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                value={confirmPassword}
                onChange={setConfirmPassword}
              />
              <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
                {loading ? 'Updating password...' : 'Update password'}
              </button>
            </form>
          )}
          <p style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
            <Link to="/login" style={{ color: 'var(--color-secondary)', fontWeight: 600 }}>Return to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
