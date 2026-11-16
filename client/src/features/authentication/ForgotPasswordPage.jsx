import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authAPI } from '../../services/api';
import { Input } from '../../components/forms/Input';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await authAPI.forgotPassword({ email });
      setSent(true);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not request a password reset. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div>
          <h1>REO Travel Academy</h1>
          <p>Regain access to your learning and academic records.</p>
        </div>
        <p style={{ marginTop: 'auto', opacity: 0.8, fontSize: 13 }}>© 2026 Reo Travel Academy. All rights reserved.</p>
      </aside>
      <div className="auth-form-wrap">
        <div className="auth-card">
          <h2>Reset your password</h2>
          <p className="subtitle">Enter the email address associated with your account.</p>
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {sent ? (
            <div className="notice" role="status">
              If the address is associated with an account, password reset instructions have been sent.
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <Input
                label="Email address"
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={setEmail}
              />
              <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
                {loading ? 'Sending instructions...' : 'Send reset instructions'}
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
