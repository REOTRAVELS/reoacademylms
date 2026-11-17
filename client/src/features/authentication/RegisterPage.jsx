import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, Phone } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/forms/Input';
import { applicationsAPI } from '../../services/api';

const registrationErrorMessage = (error) => {
  const message = error.response?.data?.message;
  const requestId = error.response?.data?.requestId || error.response?.headers?.['x-request-id'];
  if (message) return requestId ? `${message} (Reference: ${requestId})` : message;
  if (error.response) return `Registration failed with HTTP ${error.response.status}. Please try again.`;
  return 'Could not reach the server. Check your connection and try again.';
};

export default function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const [offeringsLoading, setOfferingsLoading] = useState(true);
  const [offerings, setOfferings] = useState([]);
  const [error, setError] = useState('');
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    programOfferingId: '',
  });

  useEffect(() => {
    applicationsAPI.offerings()
      .then(({ data }) => setOfferings(data.data || []))
      .catch((requestError) => {
        setError(requestError.response?.data?.message || 'Could not load open Program offerings.');
      })
      .finally(() => setOfferingsLoading(false));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone || undefined,
        password: form.password,
        confirmPassword: form.confirmPassword,
        programOfferingId: form.programOfferingId,
      };
      await register(data);
      navigate('/pending');
    } catch (err) {
      setError(registrationErrorMessage(err));
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
          <p>Join a community of travel professionals advancing their careers through accredited, institution-backed learning programmes.</p>
        </div>
        <div>
          <p style={{ marginTop: 'auto', opacity: 0.8, fontSize: 13 }}>© 2026 Reo Travel Academy. All rights reserved.</p>
        </div>
      </aside>

      <div className="auth-form-wrap">
        <div className="auth-card">
          <h2>Create your account</h2>
          <p className="subtitle">Choose one open Program offering. Your application will be reviewed before academic access is activated.</p>
          {error && (
            <div style={{ background: '#FDECEC', color: 'var(--color-danger)', padding: 12, borderRadius: 6, marginBottom: 20, fontSize: 13, border: '1px solid #F5C6C6' }}>
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} noValidate>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Input
                label="First name"
                name="firstName"
                placeholder="Kofi"
                required
                value={form.firstName}
                onChange={(v) => setForm({ ...form, firstName: v })}
              />
              <Input
                label="Last name"
                name="lastName"
                placeholder="Learner"
                required
                value={form.lastName}
                onChange={(v) => setForm({ ...form, lastName: v })}
              />
            </div>
            <Input
              label="Email address"
              type="email"
              name="email"
              placeholder="name@example.com"
              required
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
            />
            <Input
              label="Phone number"
              name="phone"
              placeholder="+233 XX XXX XXXX"
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
            />
            <Select
              label="Program and Intake"
              value={form.programOfferingId}
              onChange={(value) => setForm({ ...form, programOfferingId: value })}
              options={offerings.map((offering) => ({
                value: offering.id,
                label: `${offering.programme.title} — GATE ${String(offering.intake.gateNumber).padStart(2, '0')} ${offering.intake.season} ${offering.intake.year}`,
              }))}
              required
              disabled={offeringsLoading || offerings.length === 0}
            />
            {!offeringsLoading && !error && offerings.length === 0 && (
              <p className="notice notice-warning">There are no open Program offerings right now. Please check back later.</p>
            )}
            <Input
              label="Password"
              type="password"
              name="password"
              placeholder="••••••••"
              required
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
            />
            <Input
              label="Confirm password"
              type="password"
              name="confirmPassword"
              placeholder="••••••••"
              required
              value={form.confirmPassword}
              onChange={(v) => setForm({ ...form, confirmPassword: v })}
            />
            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading || offeringsLoading || offerings.length === 0}>
              {loading ? 'Submitting application...' : 'Apply'}
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
