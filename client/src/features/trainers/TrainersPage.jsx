import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Trash2, UserPlus } from 'lucide-react';
import { authAPI, usersAPI } from '../../services/api';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/forms/Input';
import DataTable from '../../components/tables/DataTable';

export default function TrainersPage() {
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [creatingInvitation, setCreatingInvitation] = useState(false);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');
  const [invitationUrl, setInvitationUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadTrainers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await usersAPI.list({ role: 'TRAINER', search: search.trim() || undefined, pageSize: 50 });
      setTrainers(data.data.items || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load trainers.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { loadTrainers(); }, [loadTrainers]);

  const createInvitation = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setInvitationUrl('');
    setCreatingInvitation(true);
    try {
      const { data } = await authAPI.createInvitation({ email, role: 'TRAINER' });
      setInvitationUrl(data.data.invitationUrl || `${window.location.origin}/accept-invite/${data.data.token}`);
      setEmail('');
      setNotice(data.data.emailStatus === 'sent' || data.data.emailSent
        ? 'Invitation emailed to the trainer. You can also copy the secure link below.'
        : data.data.emailStatus === 'failed'
          ? 'Invitation created, but the email provider failed to send it. Copy the link below and check Vercel logs.'
          : 'Invitation created, but email is not configured. Add the email settings in Vercel, or copy the link below.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not create the trainer invitation.');
    } finally {
      setCreatingInvitation(false);
    }
  };

  const deleteTrainer = async (trainer) => {
    if (!window.confirm(`Remove ${trainer.firstName} ${trainer.lastName}'s account? Their access and profile details will be removed; academy records will be retained.`)) return;
    setBusyId(trainer.id);
    setError('');
    setNotice('');
    try {
      await usersAPI.delete(trainer.id);
      setNotice(`${trainer.firstName} ${trainer.lastName}'s account was removed; academy records were retained.`);
      await loadTrainers();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete this trainer.');
    } finally {
      setBusyId('');
    }
  };

  const columns = [
    {
      key: 'name',
      label: 'Trainer',
      render: (trainer) => (
        <div className="person-cell">
          <span className="person-avatar person-avatar-violet">{`${trainer.firstName?.[0] || ''}${trainer.lastName?.[0] || ''}`.toUpperCase()}</span>
          <span><strong>{trainer.firstName} {trainer.lastName}</strong><small>{trainer.email}</small></span>
        </div>
      ),
    },
    { key: 'status', label: 'Account status', render: (trainer) => <span className={statusClass(trainer.status)}>{statusLabel(trainer.status)}</span> },
    { key: 'createdAt', label: 'Joined', render: (trainer) => new Date(trainer.createdAt).toLocaleDateString() },
    {
      key: 'actions',
      label: 'Actions',
      render: (trainer) => (
        <div className="table-actions">
          <Link className="btn btn-ghost btn-sm" to={`/students/${trainer.id}`}>View</Link>
          <button className="icon-button action-danger" disabled={busyId === trainer.id} onClick={() => deleteTrainer(trainer)} aria-label="Delete trainer account"><Trash2 size={16} /></button>
        </div>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <span className="eyebrow">People &amp; access</span>
          <h1>Trainer directory</h1>
          <p>Invite expert instructors and manage their academy accounts.</p>
        </div>
        <Button onClick={() => { setShowForm((open) => !open); setInvitationUrl(''); }}>
          <UserPlus size={17} /> {showForm ? 'Close invite' : 'Invite trainer'}
        </Button>
      </section>

      {showForm && (
        <section className="card invite-card">
          <div className="card-heading">
            <div><h2>Invite a trainer</h2><p>A one-time invitation link will be generated for you to share.</p></div>
          </div>
          <form className="invite-form" onSubmit={createInvitation}>
            <Input label="Trainer email" type="email" name="email" value={email} onChange={setEmail} placeholder="trainer@example.com" required />
            <Button type="submit" disabled={creatingInvitation}>
              {creatingInvitation ? 'Creating invitation…' : 'Create invitation'}
            </Button>
          </form>
          {invitationUrl && <div className="invite-link"><input readOnly value={invitationUrl} aria-label="Invitation link" /><Button variant="secondary" onClick={() => navigator.clipboard.writeText(invitationUrl)}>Copy link</Button></div>}
        </section>
      )}

      {notice && <div className="notice notice-success">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <section className="directory-toolbar card">
        <div className="directory-summary"><strong>{trainers.length}</strong><span>trainers shown</span></div>
        <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search trainers" /></label>
      </section>
      <DataTable columns={columns} data={trainers} loading={loading} emptyMessage="No trainers found. Invite an instructor to get started." />
    </div>
  );
}
