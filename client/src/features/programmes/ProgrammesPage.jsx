import { useState, useEffect } from 'react';
import { Pencil, Archive, ArchiveRestore, GraduationCap } from 'lucide-react';
import { programmesAPI } from '../../services/api';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Input';
import DataTable from '../../components/tables/DataTable';
import { statusLabel } from '../../components/common/navConfig';

export default function ProgrammesPage() {
  const [programmes, setProgrammes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ title: '', description: '', qualificationType: '', status: 'DRAFT', startDate: '', endDate: '' });

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await programmesAPI.list();
      setProgrammes(res.data.data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await programmesAPI.create(form);
      setForm({ title: '', description: '', qualificationType: '', status: 'DRAFT', startDate: '', endDate: '' });
      setShowForm(false);
      setError('');
      setNotice('Program created.');
      load();
    } catch (err) { setError(err.response?.data?.message || 'Failed to create program'); }
  };

  const renameProgramme = async (programme) => {
    const title = window.prompt('Program title', programme.title);
    if (title === null || !title.trim() || title.trim() === programme.title) return;
    try {
      await programmesAPI.update(programme.id, { title: title.trim() });
      setError('');
      setNotice('Program updated.');
      await load();
    } catch (err) { setError(err.response?.data?.message || 'Failed to update program'); }
  };

  const duplicateProgramme = async (programme) => {
    const title = window.prompt('Duplicate program title', `${programme.title} (copy)`);
    if (title === null || !title.trim()) return;
    try {
      await programmesAPI.create({ title: title.trim(), description: programme.description, status: programme.status, startDate: programme.startDate, endDate: programme.endDate });
      setNotice('Program duplicated.');
      await load();
    } catch (err) { setError(err.response?.data?.message || 'Failed to duplicate program'); }
  };

  const toggleProgrammeStatus = async (programme) => {
    const newStatus = programme.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE';
    try {
      await programmesAPI.update(programme.id, { status: newStatus });
      setNotice(`Program status updated to ${newStatus}.`);
      await load();
    } catch (err) { setError(err.response?.data?.message || 'Failed to update program status'); }
  };

  const editQualificationType = async (programme) => {
    const qualificationType = window.prompt('Qualification type (leave blank to clear)', programme.qualificationType || '');
    if (qualificationType === null || qualificationType.trim() === (programme.qualificationType || '')) return;
    try {
      await programmesAPI.update(programme.id, { qualificationType: qualificationType.trim() || null });
      setError('');
      setNotice('Qualification type updated.');
      await load();
    } catch (err) { setError(err.response?.data?.message || 'Failed to update qualification type'); }
  };

  const columns = [
    { key: 'title', label: 'Title' },
    { key: 'qualificationType', label: 'Qualification', render: (r) => r.qualificationType || '—' },
    { key: 'status', label: 'Status', render: (r) => <span className={`badge ${r.status.toLowerCase()}`}>{statusLabel(r.status)}</span> },
    { key: 'startDate', label: 'Start', render: (r) => r.startDate ? new Date(r.startDate).toLocaleDateString() : '—' },
    { key: 'endDate', label: 'End', render: (r) => r.endDate ? new Date(r.endDate).toLocaleDateString() : '—' },
    { key: 'actions', label: 'Actions', render: (r) => <div className="table-actions">
      <button className="icon-button" onClick={() => renameProgramme(r)} title="Rename program" aria-label={`Rename ${r.title}`}><Pencil size={15} /></button>
      <button className="icon-button" onClick={() => editQualificationType(r)} title="Edit qualification type" aria-label={`Edit qualification type for ${r.title}`}><GraduationCap size={15} /></button>
      <button className="icon-button" onClick={() => toggleProgrammeStatus(r)} title={r.status === 'ACTIVE' ? 'Archive program' : 'Activate program'} aria-label={`${r.status === 'ACTIVE' ? 'Archive' : 'Activate'} ${r.title}`}>
        {r.status === 'ACTIVE' ? <Archive size={15} /> : <ArchiveRestore size={15} />}
      </button>
    </div> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, marginBottom: 4 }}>Programs</h1>
          <p style={{ color: 'var(--color-text-muted)' }}>Manage training programs.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ New Program'}</Button>
      </div>

      {notice && <div className="notice notice-success">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {showForm && (
        <div style={{ maxWidth: 600, margin: '0 auto', padding: 24, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Create Program</h3>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
            <Input label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required />
            <Input label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
            <Input label="Qualification Type" value={form.qualificationType} onChange={(v) => setForm({ ...form, qualificationType: v })} placeholder="Optional" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Input label="Start Date" type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
              <Input label="End Date" type="date" value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} />
            </div>
            <Select label="Status" value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={[{ value: 'DRAFT', label: 'Draft' }, { value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }]} />
            <Button type="submit" variant="primary">Create Program</Button>
          </form>
        </div>
      )}

      <DataTable columns={columns} data={programmes} loading={loading} emptyMessage="No programs found" />
    </div>
  );
}
