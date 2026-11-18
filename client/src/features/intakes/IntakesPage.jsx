import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/forms/Input';
import DataTable from '../../components/tables/DataTable';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import { intakesAPI } from '../../services/api';
import { formatIntakeStart } from './intakeDateTime';

const seasonsByGate = { 1: 'WINTER', 2: 'SPRING', 3: 'SUMMER', 4: 'FALL' };
const gatesBySeason = Object.fromEntries(Object.entries(seasonsByGate).map(([gate, season]) => [season, gate]));
const seasonLabels = { WINTER: 'WINTER', SPRING: 'SPRING', SUMMER: 'SUMMER', FALL: 'FALL' };
const intakeStatuses = [
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const emptyForm = () => {
  const now = new Date();
  return {
    gateNumber: 1,
    season: 'WINTER',
    year: now.getFullYear() + (now.getMonth() >= 3 ? 1 : 0),
    timezone: 'UTC',
    status: 'UPCOMING',
  };
};

export default function IntakesPage() {
  const [intakes, setIntakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await intakesAPI.list();
      setIntakes(data.data || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load intakes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await intakesAPI.create({ ...form, gateNumber: Number(form.gateNumber), year: Number(form.year) });
      setForm(emptyForm());
      setShowForm(false);
      setNotice('Intake created.');
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not create the intake.');
    }
  };

  const columns = [
    { key: 'gateNumber', label: 'Gate', render: (intake) => `GATE ${String(intake.gateNumber).padStart(2, '0')}` },
    { key: 'season', label: 'Season', render: (intake) => `${seasonLabels[intake.season]} ${intake.year}` },
    {
      key: 'nextProgramStart',
      label: 'Next program start',
      render: (intake) => {
        const nextStart = (intake.programOfferings || [])
          .filter((offering) => offering.status === 'ACTIVE' && new Date(offering.academicStartDate) > new Date())
          .sort((left, right) => new Date(left.academicStartDate) - new Date(right.academicStartDate))[0];
        return nextStart
          ? formatIntakeStart(nextStart.academicStartDate, intake.timezone)
          : '—';
      },
    },
    {
      key: 'admissionsOpen',
      label: 'Registration',
      render: (intake) => {
        if (intake.status === 'COMPLETED' || intake.status === 'ARCHIVED') return 'Locked';
        return intake.admissionsOpen ? 'Open' : 'Locked';
      },
    },
    { key: 'status', label: 'Status', render: (intake) => <span className={statusClass(intake.status)}>{statusLabel(intake.status)}</span> },
    { key: 'programOfferings', label: 'Programs', render: (intake) => intake.programOfferings?.length || 0 },
    { key: 'approvedStudentCount', label: 'Approved students', render: (intake) => intake.studentCounts?.approved ?? 0 },
    { key: 'waitingStudentCount', label: 'Waiting to start', render: (intake) => intake.studentCounts?.waiting ?? 0 },
    { key: 'eligibleStudentCount', label: 'Access eligible', render: (intake) => intake.studentCounts?.eligible ?? 0 },
    { key: 'actions', label: 'Actions', render: (intake) => <Link className="btn btn-ghost btn-sm" to={`/intakes/${intake.id}`}>Manage</Link> },
  ];

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Admissions and planning</span>
          <h1>Intakes</h1>
          <p>Create an intake, then assign each program its own academic dates.</p>
        </div>
        <Button onClick={() => setShowForm((visible) => !visible)}>
          <CalendarRange size={16} /> {showForm ? 'Cancel' : 'New intake'}
        </Button>
      </div>

      {notice && <div className="notice notice-success">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}

      {showForm && (
        <section className="card">
          <div className="card-heading"><div><span className="eyebrow">Intake setup</span><h2>Create intake</h2></div></div>
          <form onSubmit={handleSubmit} className="intake-form">
            <p className="intake-period-hint">Program academic dates are set individually after the intake is created.</p>
            <div className="intake-form-grid">
              <Select
                label="Gate"
                value={String(form.gateNumber)}
                onChange={(value) => setForm((current) => ({ ...current, gateNumber: Number(value), season: seasonsByGate[value] }))}
                options={Object.keys(seasonsByGate).map((gate) => ({ value: gate, label: `GATE ${gate.padStart(2, '0')}` }))}
                required
              />
              <Select
                label="Season"
                value={form.season}
                onChange={(season) => setForm((current) => ({ ...current, season, gateNumber: Number(gatesBySeason[season]) }))}
                options={Object.entries(seasonLabels).map(([value, label]) => ({ value, label }))}
                required
              />
              <Input label="Year" type="number" min="2000" max="9999" value={form.year} onChange={(value) => setForm((current) => ({ ...current, year: value }))} required />
              <Input label="Timezone (IANA)" placeholder="UTC or Africa/Lagos" value={form.timezone} onChange={(value) => setForm((current) => ({ ...current, timezone: value }))} required />
              <Select label="Status" value={form.status} onChange={(value) => setForm((current) => ({ ...current, status: value }))} options={intakeStatuses} required />
            </div>
            <div className="intake-form-actions"><Button type="submit">Create intake</Button></div>
          </form>
        </section>
      )}

      <DataTable columns={columns} data={intakes} loading={loading} emptyMessage="No intakes have been created yet." />
    </div>
  );
}
