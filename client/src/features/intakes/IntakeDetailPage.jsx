import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/forms/Input';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import { intakesAPI, programmesAPI } from '../../services/api';
import { validateIntakePeriod } from './intakeValidation';
import { formatIntakeDate, formatIntakeStart, toDateTimeLocal } from './intakeDateTime';

const seasonLabels = { WINTER: 'WINTER', SPRING: 'SPRING', SUMMER: 'SUMMER', FALL: 'FALL' };
const intakeStatuses = [
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ARCHIVED', label: 'Archived' },
];
const seasonsByGate = { 1: 'WINTER', 2: 'SPRING', 3: 'SUMMER', 4: 'FALL' };
const gatesBySeason = Object.fromEntries(Object.entries(seasonsByGate).map(([gate, season]) => [season, gate]));
const toEditForm = (intake) => ({
  gateNumber: intake.gateNumber,
  season: intake.season,
  year: intake.year,
  timezone: intake.timezone,
  academicStartDate: toDateTimeLocal(intake.academicStartDate, intake.timezone),
  academicEndDate: String(intake.academicEndDate).slice(0, 10),
});

export default function IntakeDetailPage() {
  const { id } = useParams();
  const [intake, setIntake] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [programmes, setProgrammes] = useState([]);
  const [selectedProgrammeIds, setSelectedProgrammeIds] = useState([]);
  const [offeringStatus, setOfferingStatus] = useState('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [{ data: intakeResponse }, { data: programmeResponse }] = await Promise.all([
        intakesAPI.get(id),
        programmesAPI.list(),
      ]);
      setIntake(intakeResponse.data);
      setEditForm(toEditForm(intakeResponse.data));
      setProgrammes(programmeResponse.data || []);
    } catch (requestError) {
      setIntake(null);
      setError(requestError.response?.data?.message || 'Could not load this intake.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const existingProgrammeIds = useMemo(
    () => new Set(intake?.programOfferings?.map(({ programmeId }) => programmeId) || []),
    [intake],
  );
  const availableProgrammes = programmes.filter(
    (programme) => programme.status !== 'ARCHIVED' && !existingProgrammeIds.has(programme.id),
  );

  const runAction = async (action, successMessage) => {
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(successMessage);
      await load();
      return true;
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update this intake.');
      return false;
    }
  };

  const updateStatus = (status) => runAction(
    () => intakesAPI.update(id, { status }),
    'Intake status updated.',
  );

  const toggleAdmissions = () => runAction(
    () => intakesAPI.update(id, { admissionsOpen: !intake.admissionsOpen }),
    `Registration ${intake.admissionsOpen ? 'locked' : 'unlocked'}.`,
  );

  const addProgrammes = async (event) => {
    event.preventDefault();
    if (!selectedProgrammeIds.length) return;
    const added = await runAction(
      () => intakesAPI.addOfferings(id, selectedProgrammeIds, offeringStatus),
      'Program offerings added.',
    );
    if (added) setSelectedProgrammeIds([]);
  };

  const updateDetails = async (event) => {
    event.preventDefault();
    const periodError = validateIntakePeriod(editForm);
    if (periodError) {
      setError(periodError);
      return;
    }
    const updated = await runAction(
      () => intakesAPI.update(id, {
        ...editForm,
        gateNumber: Number(editForm.gateNumber),
        year: Number(editForm.year),
      }),
      'Intake details updated.',
    );
    if (updated) setEditing(false);
  };

  const toggleEditing = () => {
    if (editing) setEditForm(toEditForm(intake));
    setEditing((current) => !current);
  };

  if (loading) return <div className="card loading-card" role="status">Loading intake…</div>;
  if (!intake) {
    return (
      <div className="page-stack">
        <div className="notice notice-error" role="alert">{error || 'Intake not found.'}</div>
        <Link className="btn btn-secondary" to="/intakes"><ArrowLeft size={16} /> Back to intakes</Link>
      </div>
    );
  }

  const intakeStarted = new Date(intake.academicStartDate).getTime() <= Date.now();
  const admissionsUnavailable = intake.status === 'ARCHIVED' || intake.status === 'COMPLETED';
  const registrationOpen = intake.admissionsOpen && !intakeStarted && !admissionsUnavailable;
  return (
    <div className="page-stack">
      <Link className="back-link" to="/intakes"><ArrowLeft size={16} /> All intakes</Link>
      <section className="card">
        <div className="intake-detail-heading">
          <div>
            <span className="eyebrow">GATE {String(intake.gateNumber).padStart(2, '0')} · {seasonLabels[intake.season]} {intake.year}</span>
            <h1>Intake overview</h1>
            <p>{intake.timezone} · {formatIntakeStart(intake.academicStartDate, intake.timezone)} – {formatIntakeDate(intake.academicEndDate)}</p>
          </div>
          <span className={statusClass(intake.status)}>{statusLabel(intake.status)}</span>
        </div>
        {notice && <div className="notice notice-success">{notice}</div>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div className="intake-date-grid">
          <div><span>Academic period</span><strong>{formatIntakeStart(intake.academicStartDate, intake.timezone)} – {formatIntakeDate(intake.academicEndDate)}</strong></div>
          <div><span>Program offerings</span><strong>{intake.programOfferings.length}</strong></div>
          <div><span>Registration</span><strong>{intakeStarted ? 'Locked · intake started' : registrationOpen ? 'Open' : 'Locked'}</strong></div>
          <div><span>Approved students</span><strong>{intake.studentCounts?.approved ?? 0}</strong></div>
          <div><span>Waiting to start</span><strong>{intake.studentCounts?.waiting ?? 0}</strong></div>
          <div><span>Access eligible</span><strong>{intake.studentCounts?.eligible ?? 0}</strong></div>
        </div>
        <div className="intake-action-row">
          <Button
            variant={registrationOpen ? 'secondary' : 'primary'}
            onClick={toggleAdmissions}
            disabled={admissionsUnavailable || intakeStarted}
          >
            {registrationOpen ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
            {intakeStarted ? 'Intake has started' : registrationOpen ? 'Lock registration' : 'Unlock registration'}
          </Button>
          <Select
            aria-label="Intake status"
            value={intake.status}
            onChange={(status) => updateStatus(status)}
            options={intakeStatuses}
          />
        </div>
        <p className="intake-admissions-note">
          Registration stays open until the academic start time. Lock it early here if needed; started intakes are automatically removed from signup.
        </p>
      </section>

      <section className="card">
        <div className="card-heading">
          <div><span className="eyebrow">Intake configuration</span><h2>Dates and GATE</h2></div>
          <Button variant="outline" onClick={toggleEditing}>
            {editing ? 'Cancel editing' : 'Edit details'}
          </Button>
        </div>
        {editing && (
          <form onSubmit={updateDetails} className="intake-form">
            <p className="intake-period-hint">The academic start is entered in the selected IANA timezone. Academic dates must fall within the selected GATE period and year.</p>
            <div className="intake-form-grid">
              <Select
                label="GATE"
                value={String(editForm.gateNumber)}
                onChange={(value) => setEditForm((current) => ({
                  ...current,
                  gateNumber: Number(value),
                  season: seasonsByGate[value],
                }))}
                options={Object.keys(seasonsByGate).map((gate) => ({
                  value: gate,
                  label: `GATE ${gate.padStart(2, '0')}`,
                }))}
                required
              />
              <Select
                label="Season"
                value={editForm.season}
                onChange={(season) => setEditForm((current) => ({
                  ...current,
                  season,
                  gateNumber: Number(gatesBySeason[season]),
                }))}
                options={Object.entries(seasonLabels).map(([value, label]) => ({ value, label }))}
                required
              />
              <Input label="Year" type="number" min="2000" max="9999" value={editForm.year} onChange={(value) => setEditForm((current) => ({ ...current, year: value }))} required />
              <Input label="Timezone (IANA)" placeholder="UTC or Africa/Lagos" value={editForm.timezone} onChange={(value) => setEditForm((current) => ({ ...current, timezone: value }))} required />
              <Input label={`Academic start (${editForm.timezone || 'UTC'})`} type="datetime-local" value={editForm.academicStartDate} onChange={(value) => setEditForm((current) => ({ ...current, academicStartDate: value }))} required />
              <Input label="Academic end" type="date" value={editForm.academicEndDate} onChange={(value) => setEditForm((current) => ({ ...current, academicEndDate: value }))} required />
            </div>
            <div className="intake-form-actions"><Button type="submit">Save intake details</Button></div>
          </form>
        )}
      </section>

      <section className="card">
        <div className="card-heading">
          <div><span className="eyebrow">Change history</span><h2>Academic start-time history</h2></div>
        </div>
        {intake.auditHistory?.length ? (
          <div className="activity-list">
            {intake.auditHistory.map((entry) => {
              const details = entry.metadata || {};
              return (
                <article className="activity-row" key={entry.id}>
                  <span className="activity-dot" />
                  <span className="activity-description">
                    <strong>{entry.actor} updated the official start</strong>
                    <small>
                      {details.previousAcademicStartDate
                        ? `${formatIntakeStart(details.previousAcademicStartDate, details.previousTimezone || intake.timezone)} (${details.previousTimezone || intake.timezone}) → `
                        : 'Previous start unavailable → '}
                      {details.academicStartDate
                        ? `${formatIntakeStart(details.academicStartDate, details.timezone || intake.timezone)} (${details.timezone || intake.timezone})`
                        : 'Updated start unavailable'}
                    </small>
                  </span>
                  <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state"><h3>No start-time changes recorded</h3><p>Changes to this Intake’s official start time and timezone will appear here.</p></div>
        )}
      </section>

      <section className="card">
        <div className="card-heading">
          <div><span className="eyebrow">Program catalogue</span><h2>Programs offered</h2></div>
        </div>
        <form className="intake-offering-form" onSubmit={addProgrammes}>
          <label className="field intake-programme-picker">
            <span className="label">Add programs</span>
            <select
              className="select"
              multiple
              value={selectedProgrammeIds}
              onChange={(event) => setSelectedProgrammeIds(
                Array.from(event.target.selectedOptions, (option) => option.value),
              )}
              disabled={availableProgrammes.length === 0 || admissionsUnavailable}
              aria-label="Programs to add"
            >
              {availableProgrammes.map((programme) => (
                <option key={programme.id} value={programme.id}>
                  {programme.title}{programme.qualificationType ? ` · ${programme.qualificationType}` : ''}
                </option>
              ))}
            </select>
            <small>Active program offerings are available on signup until registration is locked or the intake starts.</small>
          </label>
          <Select
            label="Initial offering status"
            value={offeringStatus}
            onChange={setOfferingStatus}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]}
            disabled={admissionsUnavailable}
          />
          <Button type="submit" disabled={!selectedProgrammeIds.length || admissionsUnavailable}>
            <Plus size={16} /> Add selected
          </Button>
        </form>

        <div className="intake-offering-list">
          {intake.programOfferings.map((offering) => (
            <article className="intake-offering" key={offering.id}>
              <div className="intake-offering-copy">
                <strong>{offering.programme.title}</strong>
                <span>{offering.programme.qualificationType || 'Qualification not specified'}</span>
                <small>
                  {offering._count.cohorts} cohort{offering._count.cohorts === 1 ? '' : 's'}
                  {' · '}{offering._count.applications} application{offering._count.applications === 1 ? '' : 's'}
                  {' · '}{offering._count.programEnrollments} enrollment{offering._count.programEnrollments === 1 ? '' : 's'}
                  {offering.cohorts.length > 0 && ` · ${offering.cohorts.map(({ name }) => name).join(', ')}`}
                </small>
              </div>
              <span className={statusClass(offering.status)}>{statusLabel(offering.status)}</span>
              <div className="table-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runAction(
                    () => intakesAPI.updateOffering(id, offering.id, offering.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'),
                    'Offering status updated.',
                  )}
                  disabled={offering.status !== 'ACTIVE' && admissionsUnavailable}
                >
                  {offering.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </Button>
                <button
                  className="icon-button action-danger"
                  type="button"
                  aria-label={`Remove ${offering.programme.title} offering`}
                  title={offering._count.cohorts || offering._count.applications || offering._count.programEnrollments
                    ? 'Deactivate instead; dependent records exist'
                    : 'Remove offering'}
                  disabled={offering._count.cohorts > 0 || offering._count.applications > 0 || offering._count.programEnrollments > 0}
                  onClick={() => {
                    if (window.confirm(`Remove ${offering.programme.title} from this intake?`)) {
                      runAction(() => intakesAPI.removeOffering(id, offering.id), 'Offering removed.');
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
          {!intake.programOfferings.length && <div className="empty-state"><p>No programs are attached to this intake yet.</p></div>}
        </div>
      </section>
    </div>
  );
}
