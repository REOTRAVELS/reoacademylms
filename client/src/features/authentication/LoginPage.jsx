import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, Phone } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/forms/Input';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = {
        email: form.email,
        password: form.password,
      };
      const user = await login(data);
      if (user?.status !== 'ACTIVE' || (user.academicAccess === false && user.intakeAccessState !== 'WAITING')) {
        navigate('/pending');
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div>
          <h1>REO Travel Academy</h1>
          <p>The premier learning management system for travel and tourism professionals. Sign in to access your courses, assessments, and academic records.</p>
        </div>
        <div>
          <p style={{ marginTop: 'auto', opacity: 0.8, fontSize: 13 }}>© 2026 Reo Travel Academy. All rights reserved.</p>
        </div>
      </aside>

      <div className="auth-form-wrap">
        <div className="auth-card">
          <h2>Welcome back</h2>
          <p className="subtitle">Sign in to your Reo Travel Academy account</p>
          {error && (
            <div style={{ background: '#FDECEC', color: 'var(--color-danger)', padding: 12, borderRadius: 6, marginBottom: 20, fontSize: 13, border: '1px solid #F5C6C6' }}>
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} noValidate>
            <Input
              label="Email address"
              type="email"
              name="email"
              placeholder="name@reotravel.academy"
              required
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
            />
            <Input
              label="Password"
              type="password"
              name="password"
              placeholder="••••••••"
              required
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
            />
            <p style={{ marginTop: -8, marginBottom: 20, textAlign: 'right', fontSize: 13 }}>
              <Link to="/forgot-password" style={{ color: 'var(--color-secondary)', fontWeight: 600 }}>Forgot password?</Link>
            </p>
            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
          <p style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
            New to the academy? <Link to="/register" style={{ color: 'var(--color-secondary)', fontWeight: 600 }}>Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
