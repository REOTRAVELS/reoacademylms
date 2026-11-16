import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { usersAPI, authAPI } from '../../services/api';
import { statusLabel } from '../../components/common/navConfig';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';

export default function StudentProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    usersAPI.get(id)
      .then((res) => setUser(res.data.data))
      .catch((requestError) => setError(requestError.response?.data?.message || 'Could not load this account.'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleAction = async (action) => {
    setSaving(true);
    setError('');
    try {
      await authAPI.approveUser({ userId: id, action });
      setModalOpen(false);
      const { data } = await usersAPI.get(id);
      setUser(data.data);
      const actionLabel = {
        approve: 'approved',
        reject: 'rejected',
        suspend: 'suspended',
        reactivate: 'reactivated',
      }[action];
      setNotice(`Account ${actionLabel}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update this account.');
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async () => {
    if (!window.confirm(`Permanently delete ${user.firstName} ${user.lastName}'s account? This cannot be undone.`)) return;
    setSaving(true);
    setError('');
    try {
      await usersAPI.delete(id);
      navigate('/students', { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete this account.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="card" style={{ padding: 60 }}>Loading...</div>;
  if (!user) return <div className="page-stack">
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    <div className="card" style={{ padding: 60 }}>User not found.</div>
  </div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 28, marginBottom: 4 }}>{user.firstName} {user.lastName}</h1>
          <p style={{ color: 'var(--color-text-muted)' }}>{user.email}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/students" className="btn btn-ghost btn-sm">Back</Link>
        </div>
      </div>

      {notice && <div className="notice notice-success">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <p><strong>Role:</strong> {user.role}</p>
            <p><strong>Status:</strong> <span className={`badge ${user.status.toLowerCase()}`}>{statusLabel(user.status)}</span></p>
            <p><strong>Phone:</strong> {user.phone || '—'}</p>
            <p><strong>Registered:</strong> {new Date(user.createdAt).toLocaleDateString()}</p>
            <p><strong>Last login:</strong> {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</p>
          </div>
          <div style={{ display: 'flex', gap: 12, flexDirection: 'column' }}>
            {(user.status === 'PENDING' || user.status === 'REJECTED') && (
              <Link to="/applications" className="btn btn-secondary">Review Program applications</Link>
            )}
            {user.status === 'ACTIVE' && (
              <Button variant="danger" onClick={() => { setPendingAction('suspend'); setModalOpen(true); }} style={{ width: '100%' }}>
                Suspend Account
              </Button>
            )}
            {user.status === 'SUSPENDED' && (
              <Button onClick={() => { setPendingAction('reactivate'); setModalOpen(true); }} style={{ width: '100%' }}>
                Reactivate Account
              </Button>
            )}
            <Button variant="danger" disabled={saving} onClick={deleteAccount} style={{ width: '100%' }}>
              Delete Account
            </Button>
          </div>
        </div>
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Confirm Action">
        <p style={{ marginBottom: 20 }}>Are you sure you want to {pendingAction} this account?</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={() => handleAction(pendingAction)} disabled={saving}>{saving ? 'Saving…' : 'Confirm'}</Button>
        </div>
      </Modal>
    </div>
  );
}
