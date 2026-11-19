import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarRange, Download, Plus, ToggleLeft, ToggleRight, Trash2, Upload } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/forms/Input';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import { intakesAPI, programmesAPI } from '../../services/api';
import { validateIntakePeriod } from './intakeValidation';
import { formatIntakeDate, formatIntakeStart, toDateTimeLocal } from './intakeDateTime';
import WeeklyTimetableFields from './WeeklyTimetableFields';

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
});

export default function IntakeDetailPage() {
  const { id } = useParams();
  const [intake, setIntake] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [programmes, setProgrammes] = useState([]);
  const [offeringForm, setOfferingForm] = useState({
    programmeId: '',
    academicStartDate: '',
    academicEndDate: '',
  });
  const [offeringStatus, setOfferingStatus] = useState('ACTIVE');
  const [editingOfferingId, setEditingOfferingId] = useState(null);
  const [offeringEditForm, setOfferingEditForm] = useState(null);
  const [editingTimetableId, setEditingTimetableId] = useState(null);
  const [timetableSchedule, setTimetableSchedule] = useState('');
  const [uploadingOfferingId, setUploadingOfferingId] = useState(null);
  const [deletingTimetableId, setDeletingTimetableId] = useState(null);
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
  const admissionsUnavailable = intake?.status === 'ARCHIVED' || intake?.status === 'COMPLETED';

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
    if (!offeringForm.programmeId) return;
    const periodError = validateIntakePeriod({
      ...offeringForm,
      season: intake.season,
      year: intake.year,
    });
    if (periodError) {
      setError(periodError);
      return;
    }
    const added = await runAction(
      () => intakesAPI.addOfferings(id, [{
        programmeId: offeringForm.programmeId,
        academicStartDate: offeringForm.academicStartDate,
        academicEndDate: offeringForm.academicEndDate,
      }], offeringStatus),
      'Program offering added.',
    );
    if (added) {
      setOfferingForm({ programmeId: '', academicStartDate: '', academicEndDate: '' });
    }
  };

  const updateDetails = async (event) => {
    event.preventDefault();
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

  const startEditingOffering = (offering) => {
    setEditingOfferingId(offering.id);
    setOfferingEditForm({
      academicStartDate: toDateTimeLocal(offering.academicStartDate, intake.timezone),
      academicEndDate: String(offering.academicEndDate).slice(0, 10),
    });
  };

  const saveOfferingDates = async (event, offering) => {
    event.preventDefault();
    const periodError = validateIntakePeriod({
      ...offeringEditForm,
      season: intake.season,
      year: intake.year,
    });
    if (periodError) {
      setError(periodError);
      return;
    }
    const updated = await runAction(
      () => intakesAPI.updateOffering(id, offering.id, offeringEditForm),
      'Program academic dates updated.',
    );
    if (updated) {
      setEditingOfferingId(null);
      setOfferingEditForm(null);
    }
  };

  const startEditingTimetable = (offering) => {
    setEditingTimetableId(offering.id);
    setTimetableSchedule(offering.schedule || '');
  };

  const saveOfferingTimetable = async (event, offering) => {
    event.preventDefault();
    const updated = await runAction(
      () => intakesAPI.updateOffering(id, offering.id, { schedule: timetableSchedule || null }),
      'Program timetable updated. Upcoming class sessions have been refreshed.',
    );
    if (updated) setEditingTimetableId(null);
  };

  const uploadOfferingTimetable = async (event, offering) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.timetable.files?.[0];
    if (!file) {
      setError('Choose a timetable document to upload.');
      return;
    }
    setUploadingOfferingId(offering.id);
    setError('');
    setNotice('');
    try {
      await intakesAPI.uploadTimetable(id, offering.id, file);
      form.reset();
      setNotice('Program timetable document uploaded.');
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not upload the program timetable document.');
    } finally {
      setUploadingOfferingId(null);
    }
  };

  const deleteOfferingTimetable = async (offering) => {
    if (!window.confirm(`Delete the timetable document "${offering.timetableFileName}"?`)) return;
    setDeletingTimetableId(offering.id);
    try {
      await runAction(
        () => intakesAPI.deleteTimetable(id, offering.id),
        'Timetable document deleted.',
      );
    } finally {
      setDeletingTimetableId(null);
    }
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

  const registrationOpen = intake.admissionsOpen && !admissionsUnavailable;
  return (
    <div className="page-stack">
      <Link className="back-link" to="/intakes"><ArrowLeft size={16} /> All intakes</Link>
      <section className="card">
        <div className="intake-detail-heading">
          <div>
            <span className="eyebrow">GATE {String(intake.gateNumber).padStart(2, '0')} · {seasonLabels[intake.season]} {intake.year}</span>
            <h1>Intake overview</h1>
            <p>Program dates use {intake.timezone} and are managed separately for each offering.</p>
          </div>
          <span className={statusClass(intake.status)}>{statusLabel(intake.status)}</span>
        </div>
        {notice && <div className="notice notice-success">{notice}</div>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div className="intake-date-grid">
          <div><span>Program offerings</span><strong>{intake.programOfferings.length}</strong></div>
          <div><span>Registration</span><strong>{registrationOpen ? 'Open' : 'Locked'}</strong></div>
          <div><span>Approved students</span><strong>{intake.studentCounts?.approved ?? 0}</strong></div>
          <div><span>Waiting to start</span><strong>{intake.studentCounts?.waiting ?? 0}</strong></div>
          <div><span>Access eligible</span><strong>{intake.studentCounts?.eligible ?? 0}</strong></div>
        </div>
        <div className="intake-action-row">
          <Button
            variant={registrationOpen ? 'secondary' : 'primary'}
            onClick={toggleAdmissions}
            disabled={admissionsUnavailable}
          >
            {registrationOpen ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
            {registrationOpen ? 'Lock all registration' : 'Unlock registration'}
          </Button>
          <Select
            aria-label="Intake status"
            value={intake.status}
            onChange={(status) => updateStatus(status)}
            options={intakeStatuses}
          />
        </div>
        <p className="intake-admissions-note">
          Applications close automatically at each program’s academic start time. This control can lock or unlock registration for every program in the intake.
        </p>
      </section>

      <section className="card">
        <div className="card-heading">
          <div><span className="eyebrow">Intake configuration</span><h2>GATE and timezone</h2></div>
          <Button variant="outline" onClick={toggleEditing}>
            {editing ? 'Cancel editing' : 'Edit details'}
          </Button>
        </div>
        {editing && (
          <form onSubmit={updateDetails} className="intake-form">
            <p className="intake-period-hint">Each program’s dates must fit this GATE period. Changing the GATE or timezone is blocked if it would make existing program dates invalid.</p>
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
            </div>
            <div className="intake-form-actions"><Button type="submit">Save intake details</Button></div>
          </form>
        )}
      </section>

      <section className="card">
        <div className="card-heading">
          <div><span className="eyebrow">Program catalogue</span><h2>Programs offered</h2></div>
        </div>
        <form className="intake-offering-form" onSubmit={addProgrammes}>
          <label className="field intake-programme-picker">
            <span className="label">Program</span>
            <select
              className="select"
              value={offeringForm.programmeId}
              onChange={(event) => setOfferingForm((current) => ({ ...current, programmeId: event.target.value }))}
              disabled={availableProgrammes.length === 0 || admissionsUnavailable}
              aria-label="Program to add"
              required
            >
              <option value="">Select a program</option>
              {availableProgrammes.map((programme) => (
                <option key={programme.id} value={programme.id}>
                  {programme.title}{programme.qualificationType ? ` · ${programme.qualificationType}` : ''}
                </option>
              ))}
            </select>
            <small>Each program has its own academic dates and application deadline.</small>
          </label>
          <Input
            label={`Academic start (${intake.timezone || 'UTC'})`}
            type="datetime-local"
            value={offeringForm.academicStartDate}
            onChange={(value) => setOfferingForm((current) => ({ ...current, academicStartDate: value }))}
            required
            disabled={admissionsUnavailable}
          />
          <Input
            label="Academic end"
            type="date"
            value={offeringForm.academicEndDate}
            onChange={(value) => setOfferingForm((current) => ({ ...current, academicEndDate: value }))}
            required
            disabled={admissionsUnavailable}
          />
          <Select
            label="Initial offering status"
            value={offeringStatus}
            onChange={setOfferingStatus}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]}
            disabled={admissionsUnavailable}
          />
          <Button type="submit" disabled={!offeringForm.programmeId || admissionsUnavailable}>
            <Plus size={16} /> Add program
          </Button>
        </form>

        <div className="intake-offering-list">
          {intake.programOfferings.map((offering) => {
            const dateHistory = (offering.auditHistory || [])
              .filter(({ metadata }) => metadata?.previousAcademicStartDate || metadata?.previousAcademicEndDate);
            return (
              <article className="intake-offering" key={offering.id}>
                <div className="intake-offering-copy">
                  <strong>{offering.programme.title}</strong>
                  <span>{offering.programme.qualificationType || 'Qualification not specified'}</span>
                  {editingOfferingId === offering.id ? (
                    <form className="intake-form" onSubmit={(event) => saveOfferingDates(event, offering)}>
                      <div className="intake-form-grid">
                        <Input
                          label={`Academic start (${intake.timezone || 'UTC'})`}
                          type="datetime-local"
                          value={offeringEditForm.academicStartDate}
                          onChange={(value) => setOfferingEditForm((current) => ({ ...current, academicStartDate: value }))}
                          required
                        />
                        <Input
                          label="Academic end"
                          type="date"
                          value={offeringEditForm.academicEndDate}
                          onChange={(value) => setOfferingEditForm((current) => ({ ...current, academicEndDate: value }))}
                          required
                        />
                      </div>
                      <div className="intake-form-actions">
                        <Button type="submit" size="sm"><CalendarRange size={15} /> Save dates</Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditingOfferingId(null)}>Cancel</Button>
                      </div>
                    </form>
                  ) : (
                    <span>
                      {formatIntakeStart(offering.academicStartDate, intake.timezone)}
                      {' – '}{formatIntakeDate(offering.academicEndDate)}
                    </span>
                  )}
                  <small>
                    {offering._count.cohorts} cohort{offering._count.cohorts === 1 ? '' : 's'}
                    {' · '}{offering._count.applications} application{offering._count.applications === 1 ? '' : 's'}
                    {' · '}{offering._count.programEnrollments} enrollment{offering._count.programEnrollments === 1 ? '' : 's'}
                    {offering.cohorts.length > 0 && ` · ${offering.cohorts.map(({ name }) => name).join(', ')}`}
                  </small>
                  {dateHistory.length > 0 && (
                    <details>
                      <summary>Academic date history ({dateHistory.length})</summary>
                      <div className="activity-list">
                        {dateHistory.map((entry) => (
                          <article className="activity-row" key={entry.id}>
                            <span className="activity-dot" />
                            <span className="activity-description">
                              <strong>{entry.actor} updated program dates</strong>
                              <small>
                                {entry.metadata.previousAcademicStartDate
                                  ? formatIntakeStart(entry.metadata.previousAcademicStartDate, intake.timezone)
                                  : 'Start date unchanged'}
                                {' – '}
                                {entry.metadata.previousAcademicEndDate
                                  ? formatIntakeDate(entry.metadata.previousAcademicEndDate)
                                  : 'End date unchanged'}
                                {' → '}
                                {formatIntakeStart(entry.metadata.academicStartDate, intake.timezone)}
                                {' – '}
                                {formatIntakeDate(entry.metadata.academicEndDate)}
                              </small>
                            </span>
                            <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
                          </article>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
                <details className="intake-offering-timetable">
                  <summary>Weekly timetable and document</summary>
                  <p className="field-hint">
                    This schedule applies to courses in cohorts assigned to this program offering. Class dates follow the program’s academic dates and the intake timezone ({intake.timezone}).
                  </p>
                  {editingTimetableId === offering.id ? (
                    <form className="intake-form" onSubmit={(event) => saveOfferingTimetable(event, offering)}>
                      <WeeklyTimetableFields
                        schedule={timetableSchedule}
                        timezone={intake.timezone}
                        onChange={setTimetableSchedule}
                      />
                      <div className="intake-form-actions">
                        <Button type="submit" size="sm">Save timetable</Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditingTimetableId(null)}>Cancel</Button>
                      </div>
                    </form>
                  ) : (
                    <div className="intake-offering-timetable-current">
                      <span>{offering.schedule || 'No weekly class schedule configured.'}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startEditingTimetable(offering)}
                        disabled={editingTimetableId !== null}
                      >
                        Edit weekly timetable
                      </Button>
                    </div>
                  )}
                  <form className="intake-offering-timetable-upload" onSubmit={(event) => uploadOfferingTimetable(event, offering)}>
                    <label className="form-field">
                      <span>Upload timetable document</span>
                      <input
                        type="file"
                        name="timetable"
                        accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv"
                        aria-describedby={`timetable-upload-help-${offering.id}`}
                      />
                    </label>
                    <span className="field-hint" id={`timetable-upload-help-${offering.id}`}>
                      PDF, Word, PowerPoint, Excel or CSV; up to 1 GB.
                    </span>
                    <Button type="submit" size="sm" disabled={uploadingOfferingId !== null || deletingTimetableId !== null}>
                      <Upload size={15} /> {uploadingOfferingId === offering.id ? 'Uploading…' : 'Upload document'}
                    </Button>
                    {offering.timetableFileName && (
                      <>
                        <a
                          href={intakesAPI.timetableDownloadUrl(id, offering.id)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Download size={15} /> {offering.timetableFileName}
                        </a>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => deleteOfferingTimetable(offering)}
                          disabled={uploadingOfferingId !== null || deletingTimetableId !== null}
                        >
                          <Trash2 size={15} /> {deletingTimetableId === offering.id ? 'Deleting…' : 'Delete document'}
                        </Button>
                      </>
                    )}
                  </form>
                </details>
                <span className={statusClass(offering.status)}>{statusLabel(offering.status)}</span>
                <div className="table-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => startEditingOffering(offering)}
                    disabled={editingOfferingId !== null}
                  >
                    Edit dates
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runAction(
                      () => intakesAPI.updateOffering(id, offering.id, { status: offering.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
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
            );
          })}
          {!intake.programOfferings.length && <div className="empty-state"><p>No programs are attached to this intake yet.</p></div>}
        </div>
      </section>
    </div>
  );
}
