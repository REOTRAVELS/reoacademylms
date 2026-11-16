import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, CheckCircle } from 'lucide-react';
import { authAPI } from '../../services/api';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/forms/Input';

export default function AcceptInvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [valid, setValid] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (!token) {
      setError('No invitation token provided.');
      setValid(false);
    }
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = {
        token,
        password,
        confirmPassword,
      };
      const response = await authAPI.acceptInvitation(data);
      navigate(response.data.data.role === 'STUDENT' ? '/pending' : '/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to accept invitation.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div>
          <h1>REO Travel Academy</h1>
          <p>You have been invited to join the academy. Set your password to activate your account.</p>
        </div>
        <div>
          <p style={{ marginTop: 'auto', opacity: 0.8, fontSize: 13 }}>© 2026 Reo Travel Academy. All rights reserved.</p>
        </div>
      </aside>

      <div className="auth-form-wrap">
        <div className="auth-card">
          <h2>Set your password</h2>
          <p className="subtitle">Create a secure password for your new account.</p>
          {error && (
            <div style={{ background: '#FDECEC', color: 'var(--color-danger)', padding: 12, borderRadius: 6, marginBottom: 20, fontSize: 13, border: '1px solid #F5C6C6' }}>
              {error}
            </div>
          )}
          {valid === false && (
            <div style={{ background: '#FDECEC', color: 'var(--color-danger)', padding: 12, borderRadius: 6, marginBottom: 20, fontSize: 13, border: '1px solid #F5C6C6' }}>
              Invalid or expired invitation. Please contact your administrator.
            </div>
          )}
          <form onSubmit={handleSubmit} noValidate>
            <Input
              label="New password"
              type="password"
              name="password"
              placeholder="••••••••"
              required
              value={password}
              onChange={setPassword}
            />
            <Input
              label="Confirm password"
              type="password"
              name="confirmPassword"
              placeholder="••••••••"
              required
              value={confirmPassword}
              onChange={setConfirmPassword}
            />
            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Activating account...' : 'Activate account'}
            </button>
          </form>
          <p style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Already have an account? <Link to="/login" style={{ color: 'var(--color-secondary)', fontWeight: 600 }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
