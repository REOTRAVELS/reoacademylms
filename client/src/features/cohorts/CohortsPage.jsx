import { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { cohortsAPI, intakesAPI, programmesAPI } from '../../services/api';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Input';
import DataTable from '../../components/tables/DataTable';
import { statusLabel } from '../../components/common/navConfig';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

export default function CohortsPage() {
  const { user } = useAuth();
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  const isAdmin = role === 'SUPER_ADMIN';
  const [cohorts, setCohorts] = useState([]);
  const [programmes, setProgrammes] = useState([]);
  const [programOfferings, setProgramOfferings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [offeringSelections, setOfferingSelections] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ name: '', programmeId: '', intakeProgramOfferingId: '', status: 'PLANNED' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cohortsAPI.list();
      setCohorts(res.data.data || []);
    } catch (e) { setError(e.response?.data?.message || 'Could not load cohorts.'); }
    finally { setLoading(false); }
  }, []);

  const loadProgrammes = useCallback(async () => {
    try {
      const [programmeResponse, intakeResponse] = await Promise.all([programmesAPI.list(), intakesAPI.list()]);
      setProgrammes(programmeResponse.data.data || []);
      setProgramOfferings((intakeResponse.data.data || []).flatMap((intake) =>
        intake.programOfferings.map((offering) => ({
          ...offering,
          intake: {
            id: intake.id,
            gateNumber: intake.gateNumber,
            season: intake.season,
            year: intake.year,
            status: intake.status,
            timezone: intake.timezone,
          },
        })),
      ));
    } catch (e) { setError(e.response?.data?.message || 'Could not load programs and intake offerings.'); }
  }, []);

  useEffect(() => {
    void load();
    if (isAdmin) void loadProgrammes();
  }, [isAdmin, load, loadProgrammes]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await cohortsAPI.create(form);
      setForm({ name: '', programmeId: '', intakeProgramOfferingId: '', status: 'PLANNED' });
      setShowForm(false);
      setError('');
      setNotice('Cohort created.');
      load();
    } catch (err) { setError(err.response?.data?.message || 'Failed to create cohort'); }
  };

  const updateCohort = async (cohort) => {
    const name = window.prompt('Cohort name', cohort.name);
    if (name === null || !name.trim() || name.trim() === cohort.name) return;
    try {
      await cohortsAPI.update(cohort.id, { name: name.trim() });
      setError('');
      setNotice('Cohort updated.');
      await load();
    } catch (err) { setError(err.response?.data?.message || 'Failed to update cohort'); }
  };

  const deleteCohort = async (cohort) => {
    if (!window.confirm(`Permanently delete "${cohort.name}" and its enrolments and assignments? This cannot be undone.`)) return;
    try {
      await cohortsAPI.delete(cohort.id);
      setError('');
      setNotice('Cohort deleted.');
      await load();
    } catch (err) { setError(err.response?.data?.message || 'Failed to delete cohort'); }
  };

  const updateCohortOffering = async (cohort) => {
    const intakeProgramOfferingId = offeringSelections[cohort.id] ?? cohort.intakeProgramOfferingId ?? '';
    const offering = programOfferings.find((item) => item.id === intakeProgramOfferingId);
    const target = offering
      ? `${offering.programme.title} — GATE ${String(offering.intake.gateNumber).padStart(2, '0')} ${offering.intake.season} ${offering.intake.year}`
      : 'no assigned offering';
    if (!window.confirm(
      `Set "${cohort.name}" to ${target}? Only students actively enrolled in this exact Program Offering will access its teaching groups. Existing memberships and academic records will not change.`,
    )) return;
    try {
      await cohortsAPI.update(cohort.id, { intakeProgramOfferingId: intakeProgramOfferingId || null });
      setError('');
      setNotice('Cohort Program Offering updated. Existing enrolments and academic records were preserved.');
      setOfferingSelections((current) => {
        const next = { ...current };
        delete next[cohort.id];
        return next;
      });
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update the Cohort Program Offering.');
    }
  };

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'programme', label: 'Program', render: (r) => r.programme?.title || '—' },
    { key: 'intakeProgramOffering', label: 'Intake', render: (r) => r.intakeProgramOffering ? `GATE ${String(r.intakeProgramOffering.intake.gateNumber).padStart(2, '0')} · ${r.intakeProgramOffering.intake.season} ${r.intakeProgramOffering.intake.year}` : 'Not assigned' },
    ...(isAdmin ? [{
      key: 'accessOffering',
      label: 'Learning access offering',
      render: (cohort) => {
        const selected = offeringSelections[cohort.id] ?? cohort.intakeProgramOfferingId ?? '';
        const choices = programOfferings.filter((offering) => (
          offering.programmeId === cohort.programmeId
          && offering.status === 'ACTIVE'
          && ['UPCOMING', 'ACTIVE'].includes(offering.intake.status)
          && offering.programme.status === 'ACTIVE'
        ));
        return (
          <div className="table-actions">
            <select
              className="select compact-select"
              aria-label={`Learning access offering for ${cohort.name}`}
              value={selected}
              onChange={(event) => setOfferingSelections((current) => ({ ...current, [cohort.id]: event.target.value }))}
            >
              <option value="">Not assigned</option>
              {choices.map((offering) => (
                <option key={offering.id} value={offering.id}>
                  GATE {String(offering.intake.gateNumber).padStart(2, '0')} {offering.intake.season} {offering.intake.year}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={selected === (cohort.intakeProgramOfferingId || '')}
              onClick={() => updateCohortOffering(cohort)}
            >
              Save
            </Button>
          </div>
        );
      },
    }] : []),
    { key: 'status', label: 'Status', render: (r) => <span className={`badge ${r.status.toLowerCase()}`}>{statusLabel(r.status)}</span> },
    { key: 'enrolments', label: 'Learners', render: (r) => r._count?.enrolments || 0 },
    { key: 'actions', label: isAdmin ? 'Actions' : 'Details', render: (r) => <div className="table-actions">
      <Link className="btn btn-ghost btn-sm" to={`/cohorts/${r.id}`}>Manage</Link>
      {isAdmin && <>
        <button className="icon-button" onClick={() => updateCohort(r)} aria-label={`Rename ${r.name}`} title="Rename cohort"><Pencil size={15} /></button>
        <button className="icon-button action-danger" onClick={() => deleteCohort(r)} aria-label={`Delete ${r.name}`} title="Delete cohort"><Trash2 size={15} /></button>
      </>}
    </div> },
  ];

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Program delivery</span>
          <h1>Cohorts</h1>
          <p>{isAdmin ? 'Bring learners, instructors and course plans together. Cohort access is tied to its explicit Program Offering.' : 'Review your assigned learner groups and course plans.'}</p>
        </div>
        {isAdmin && <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ New Cohort'}</Button>}
      </div>

      {notice && <div className="notice notice-success">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {isAdmin && showForm && (
        <div className="card cohort-create-card">
          <h3 style={{ marginTop: 0 }}>Create Cohort</h3>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
            <Input label="Cohort Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <Select label="Program" value={form.programmeId} onChange={(v) => setForm({ ...form, programmeId: v, intakeProgramOfferingId: '' })} options={programmes.filter((p) => p.status !== 'ARCHIVED').map(p => ({ value: p.id, label: p.title }))} required />
            <Select
              label="Intake (optional)"
              value={form.intakeProgramOfferingId}
              onChange={(v) => setForm({ ...form, intakeProgramOfferingId: v })}
              options={programOfferings
                .filter((offering) =>
                  offering.programmeId === form.programmeId &&
                  offering.status === 'ACTIVE' &&
                  !['COMPLETED', 'ARCHIVED'].includes(offering.intake.status) &&
                  offering.programme.status !== 'ARCHIVED')
                .map((offering) => ({
                  value: offering.id,
                  label: `GATE ${String(offering.intake.gateNumber).padStart(2, '0')} · ${offering.intake.season} ${offering.intake.year}`,
                }))}
            />
            <Select label="Status" value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={[{ value: 'PLANNED', label: 'Planned' }, { value: 'ACTIVE', label: 'Active' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'ARCHIVED', label: 'Archived' }]} />
            <Button type="submit" variant="primary">Create Cohort</Button>
          </form>
        </div>
      )}

      <DataTable columns={columns} data={cohorts} loading={loading} emptyMessage="No cohorts found" />
    </div>
  );
}
