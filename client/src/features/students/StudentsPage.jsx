import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Eye, Search, ShieldAlert, Trash2, UserCheck, UserRoundPlus } from 'lucide-react';
import { usersAPI, authAPI } from '../../services/api';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import { Button } from '../../components/common/Button';
import DataTable from '../../components/tables/DataTable';

export default function StudentsPage() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await usersAPI.list({
        role: 'STUDENT',
        status: filter === 'all' ? undefined : filter,
        search: search.trim() || undefined,
        pageSize: 50,
      });
      setStudents(data.data.items || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load students. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => { loadStudents(); }, [loadStudents]);

  const updateStatus = async (student, action) => {
    const labels = { approve: 'approve', reject: 'reject', suspend: 'suspend', reactivate: 'reactivate' };
    if (!window.confirm(`Are you sure you want to ${labels[action]} ${student.firstName} ${student.lastName}?`)) return;
    setBusyId(student.id);
    setError('');
    setNotice('');
    try {
      await authAPI.approveUser({ userId: student.id, action });
      const pastTense = { suspend: 'suspended', reactivate: 'reactivated' };
      setNotice(`${student.firstName} ${student.lastName} was ${pastTense[action]}.`);
      await loadStudents();
    } catch (requestError) {
      setError(requestError.response?.data?.message || `Could not ${action} this account.`);
    } finally {
      setBusyId('');
    }
  };

  const deleteStudent = async (student) => {
    if (!window.confirm(`Permanently delete ${student.firstName} ${student.lastName}'s account? This cannot be undone.`)) return;
    setBusyId(student.id);
    setError('');
    setNotice('');
    try {
      await usersAPI.delete(student.id);
      setNotice(`${student.firstName} ${student.lastName}'s account was deleted.`);
      await loadStudents();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete this account.');
    } finally {
      setBusyId('');
    }
  };

  const columns = [
    {
      key: 'name',
      label: 'Student',
      render: (student) => (
        <div className="person-cell">
          <span className="person-avatar">{`${student.firstName?.[0] || ''}${student.lastName?.[0] || ''}`.toUpperCase()}</span>
          <span><strong>{student.firstName} {student.lastName}</strong><small>{student.email}</small></span>
        </div>
      ),
    },
    { key: 'phone', label: 'Phone', render: (student) => student.phone || '—' },
    { key: 'status', label: 'Status', render: (student) => <span className={statusClass(student.status)}>{statusLabel(student.status)}</span> },
    { key: 'createdAt', label: 'Registered', render: (student) => new Date(student.createdAt).toLocaleDateString() },
    {
      key: 'actions',
      label: 'Actions',
      render: (student) => (
        <div className="table-actions">
          <Link className="icon-button" to={`/students/${student.id}`} title="View profile" aria-label="View profile"><Eye size={16} /></Link>
          {student.status === 'ACTIVE' && <button className="icon-button action-danger" disabled={busyId === student.id} onClick={() => updateStatus(student, 'suspend')} title="Suspend" aria-label="Suspend"><ShieldAlert size={16} /></button>}
          {student.status === 'SUSPENDED' && <button className="icon-button action-success" disabled={busyId === student.id} onClick={() => updateStatus(student, 'reactivate')} title="Reactivate" aria-label="Reactivate"><Check size={16} /></button>}
          <button className="icon-button action-danger" disabled={busyId === student.id} onClick={() => deleteStudent(student)} title="Delete account" aria-label="Delete account"><Trash2 size={16} /></button>
        </div>
      ),
    },
  ];

  const pendingCount = students.filter((student) => student.status === 'PENDING').length;

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <span className="eyebrow">People &amp; access</span>
          <h1>Student directory</h1>
          <p>Manage student accounts. Review Program applications separately before enabling academic access.</p>
        </div>
        <div className="table-actions">
          <Link className="btn btn-secondary" to="/students/new"><UserRoundPlus size={17} /> Invite student</Link>
          <Link className="btn btn-secondary" to="/program-assignments"><UserCheck size={17} /> Assign existing students</Link>
          <Link className="btn btn-primary" to="/applications"><UserRoundPlus size={17} /> Review applications</Link>
        </div>
      </section>

      <section className="directory-toolbar card">
        <div className="directory-summary"><strong>{students.length}</strong><span>students shown</span></div>
        <div className="directory-filters">
          <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search students" /></label>
          <select className="select compact-select" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      </section>

      {pendingCount > 0 && filter === 'all' && <div className="notice notice-warning">{pendingCount} student account{pendingCount === 1 ? ' is' : 's are'} awaiting admission review.</div>}
      {notice && <div className="notice notice-success">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <DataTable columns={columns} data={students} loading={loading} emptyMessage="No students match this view yet." />
    </div>
  );
}
