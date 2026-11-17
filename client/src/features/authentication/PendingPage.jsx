import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock, LogOut } from 'lucide-react';
import { applicationsAPI, authAPI } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { Select } from '../../components/forms/Input';
import { Button } from '../../components/common/Button';

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : '—';

export default function PendingPage() {
  const [status, setStatus] = useState(null);
  const [offerings, setOfferings] = useState([]);
  const [selectedOfferingId, setSelectedOfferingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { refreshUser } = useAuth();
  const navigate = useNavigate();

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await applicationsAPI.mine();
      const result = data.data;
      setStatus(result);
      if (result.intakeAccessState === 'WAITING') {
        await refreshUser();
        navigate('/dashboard', { replace: true });
        return;
      }
      if (result.academicAccess) {
        await refreshUser();
      } else if (result.canApply) {
        const { data: offeringsResponse } = await applicationsAPI.offerings();
        setOfferings(offeringsResponse.data || []);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load your application status.');
    } finally {
      setLoading(false);
    }
  }, [navigate, refreshUser]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const submitApplication = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await applicationsAPI.submit({ programOfferingId: selectedOfferingId });
      setNotice('Your Program application has been submitted for review.');
      setSelectedOfferingId('');
      await loadStatus();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not submit your application.');
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    setError('');
    try {
      await authAPI.logout();
      navigate('/login', { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not sign out. Please try again.');
    }
  };

  if (loading) {
    return <div className="auth-page"><div className="auth-form-wrap"><div className="auth-card" role="status">Loading application status…</div></div></div>;
  }

  const application = status?.application;
  const offering = application?.programOffering;

  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div>
          <img className="auth-logo" src="/reo.png" alt="" />
          <h1>REO Travel Academy</h1>
          <p>Application decisions and Program enrollment are managed separately from academic access.</p>
        </div>
        <p style={{ marginTop: 'auto', opacity: 0.8, fontSize: 13 }}>© 2026 Reo Travel Academy. All rights reserved.</p>
      </aside>

      <div className="auth-form-wrap">
        <div className="auth-card" style={{ maxWidth: 620 }}>
          {status?.academicAccess ? (
            <>
              <CheckCircle2 size={32} style={{ color: 'var(--color-success)', marginBottom: 16 }} />
              <h2>Program enrollment active</h2>
              <p className="subtitle">Your academic access is enabled for your active Program enrollment.</p>
              {status.activeEnrollment?.programOffering && (
                <div className="card" style={{ padding: 18, marginBottom: 20 }}>
                  <strong>{status.activeEnrollment.programOffering.programme.title}</strong>
                  <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)' }}>
                    GATE {String(status.activeEnrollment.programOffering.intake.gateNumber).padStart(2, '0')} {status.activeEnrollment.programOffering.intake.season} {status.activeEnrollment.programOffering.intake.year}
                  </p>
                </div>
              )}
              <Link className="btn btn-primary" to="/dashboard">Continue to the academy</Link>
            </>
          ) : (
            <>
              <AlertCircle size={32} style={{ color: 'var(--color-warning)', marginBottom: 16 }} />
              <h2>{application?.status === 'REJECTED' ? 'Application not approved' : 'Application status'}</h2>
              <p className="subtitle">
                Academic resources stay restricted until an administrator approves a Program application and creates your enrollment.
              </p>

              {application && offering && (
                <section className="card" style={{ padding: 18, marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <Clock size={17} />
                    <strong>{application.status === 'PENDING' ? 'Under review' : application.status}</strong>
                  </div>
                  <p><strong>Program:</strong> {offering.programme.title}</p>
                  <p><strong>Intake:</strong> GATE {String(offering.intake.gateNumber).padStart(2, '0')} {offering.intake.season} {offering.intake.year}</p>
                  <p><strong>Submitted:</strong> {formatDate(application.submittedAt)}</p>
                  {application.rejectionReason && <p><strong>Reason:</strong> {application.rejectionReason}</p>}
                  {application.history?.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <strong>Status history</strong>
                      <ul>
                        {application.history.map((item) => (
                          <li key={item.id}>
                            {item.toStatus} — {formatDate(item.createdAt)}
                            {item.reason ? `: ${item.reason}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              )}

              {!application && (
                <p className="notice notice-warning">
                  Your account has no active Program assignment. Submit an application below or contact admissions if no suitable offering is open.
                </p>
              )}

              {status?.canApply && offerings.length > 0 && (
                <form onSubmit={submitApplication} className="page-stack" style={{ gap: 16 }}>
                  <Select
                    label={application?.status === 'REJECTED' ? 'Choose a Program to reapply' : 'Choose one Program and Intake'}
                    value={selectedOfferingId}
                    onChange={setSelectedOfferingId}
                    options={offerings.map((item) => ({
                      value: item.id,
                      label: `${item.programme.title} — GATE ${String(item.intake.gateNumber).padStart(2, '0')} ${item.intake.season} ${item.intake.year}`,
                    }))}
                    required
                  />
                  <Button type="submit" disabled={saving || !selectedOfferingId}>
                    {saving ? 'Submitting…' : 'Submit application'}
                  </Button>
                </form>
              )}
              {status?.canApply && offerings.length === 0 && (
                <p className="notice notice-warning">There are no open Program offerings right now. Please check back later.</p>
              )}
            </>
          )}

          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {notice && <div className="notice notice-success" role="status">{notice}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 24 }}>
            <button type="button" className="btn btn-ghost" onClick={loadStatus}>Refresh status</button>
            <Button variant="secondary" onClick={signOut}><LogOut size={15} /> Sign out</Button>
          </div>
          {!status && <p style={{ marginTop: 20, textAlign: 'center' }}>Already applied? <Link to="/login">Sign in</Link> to check your status.</p>}
        </div>
      </div>
    </div>
  );
}
