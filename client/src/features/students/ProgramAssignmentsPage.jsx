import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import DataTable from '../../components/tables/DataTable';
import { programEnrollmentsAPI } from '../../services/api';

const formatOffering = (offering) => (
  `GATE ${String(offering.intake.gateNumber).padStart(2, '0')} ${offering.intake.season} ${offering.intake.year}`
);

export default function ProgramAssignmentsPage() {
  const [students, setStudents] = useState([]);
  const [history, setHistory] = useState([]);
  const [offerings, setOfferings] = useState([]);
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [nextHistoryCursor, setNextHistoryCursor] = useState(null);
  const [selectedOfferings, setSelectedOfferings] = useState({});
  const [confirmation, setConfirmation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadStudents = useCallback(async ({ term = search, pageCursor = null, append = false } = {}) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const { data } = await programEnrollmentsAPI.legacyStudents({
        search: term.trim() || undefined,
        limit: 25,
        cursor: pageCursor || undefined,
      });
      setStudents((current) => append ? [...current, ...data.data.items] : data.data.items);
      setCursor(pageCursor);
      setNextCursor(data.data.nextCursor);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load eligible legacy students.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search]);

  const loadHistory = useCallback(async (pageCursor = null, append = false) => {
    setLoadingHistory(true);
    try {
      const { data } = await programEnrollmentsAPI.assignmentHistory({
        limit: 25,
        cursor: pageCursor || undefined,
      });
      setHistory((current) => append ? [...current, ...data.data.items] : data.data.items);
      setNextHistoryCursor(data.data.nextCursor);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load Program assignment history.');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadStudents({ term: search }); }, 250);
    return () => window.clearTimeout(timer);
  }, [search, loadStudents]);

  useEffect(() => {
    const loadOfferings = async () => {
      try {
        const { data } = await programEnrollmentsAPI.assignableOfferings();
        setOfferings(data.data);
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'Could not load active Program Offerings.');
      }
    };
    void loadOfferings();
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const selectedOffering = useMemo(
    () => offerings.find((offering) => offering.id === confirmation?.programOfferingId),
    [offerings, confirmation],
  );

  const assign = async () => {
    if (!confirmation || !selectedOffering) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await programEnrollmentsAPI.assignLegacyStudent(confirmation.student.id, {
        programOfferingId: selectedOffering.id,
      });
      setNotice(`${confirmation.student.firstName} ${confirmation.student.lastName} was assigned to ${selectedOffering.programme.title}.`);
      setConfirmation(null);
      setSelectedOfferings((current) => {
        const next = { ...current };
        delete next[confirmation.student.id];
        return next;
      });
      await Promise.all([
        loadStudents({ term: search, pageCursor: cursor }),
        loadHistory(),
      ]);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not assign this student.');
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'student',
      label: 'Legacy student',
      render: (student) => (
        <div className="person-cell">
          <span className="person-avatar">{`${student.firstName?.[0] || ''}${student.lastName?.[0] || ''}`.toUpperCase()}</span>
          <span><strong>{student.firstName} {student.lastName}</strong><small>{student.email}</small></span>
        </div>
      ),
    },
    {
      key: 'offering',
      label: 'New Program Offering',
      render: (student) => (
        <select
          className="select compact-select"
          aria-label={`Program Offering for ${student.firstName} ${student.lastName}`}
          value={selectedOfferings[student.id] || ''}
          onChange={(event) => setSelectedOfferings((current) => ({ ...current, [student.id]: event.target.value }))}
          disabled={!offerings.length || busy}
        >
          <option value="">Select a Program Offering</option>
          {offerings.map((offering) => (
            <option value={offering.id} key={offering.id}>
              {offering.programme.title} — {formatOffering(offering)}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'actions',
      label: 'Action',
      render: (student) => (
        <Button
          size="sm"
          disabled={!selectedOfferings[student.id] || busy}
          onClick={() => setConfirmation({
            student,
            programOfferingId: selectedOfferings[student.id],
          })}
        >
          Review assignment
        </Button>
      ),
    },
  ];

  const historyColumns = [
    {
      key: 'student',
      label: 'Student',
      render: (item) => `${item.student.firstName} ${item.student.lastName} · ${item.student.email}`,
    },
    {
      key: 'offering',
      label: 'Assigned Program Offering',
      render: ({ enrollment }) => (
        <span>
          <strong>{enrollment.programOffering.programme.title}</strong>
          <small>
            GATE {String(enrollment.programOffering.intake.gateNumber).padStart(2, '0')}{' '}
            {enrollment.programOffering.intake.season} {enrollment.programOffering.intake.year}
          </small>
        </span>
      ),
    },
    {
      key: 'assignedBy',
      label: 'Assigned by',
      render: (item) => `${item.assignedBy.firstName} ${item.assignedBy.lastName}`,
    },
    {
      key: 'previousState',
      label: 'Previous state',
      render: ({ previousState }) => (
        `${previousState.historicalProgramEnrollments.length} historical Program enrollment(s); no active Program`
      ),
    },
    { key: 'assignedAt', label: 'Assigned', render: (item) => new Date(item.assignedAt).toLocaleString() },
  ];

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <span className="eyebrow">People &amp; access</span>
          <h1>Legacy student Program assignments</h1>
          <p>Assign an active legacy student to one Program Offering to enable Program-scoped learning access.</p>
        </div>
      </section>

      {!loading && offerings.length === 0 && (
        <div className="notice notice-warning">
          No active Program Offerings are currently available for legacy student assignment.
        </div>
      )}

      <section className="directory-toolbar card">
        <div className="directory-summary"><strong>{students.length}</strong><span>eligible students shown</span></div>
        <label className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setCursor(null); }}
            placeholder="Search name or email"
            aria-label="Search eligible legacy students"
          />
        </label>
      </section>

      {notice && <div className="notice notice-success" role="status">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <DataTable
        columns={columns}
        data={students}
        loading={loading}
        emptyMessage="No active legacy students without a Program enrollment were found."
      />
      {nextCursor && (
        <div className="table-actions">
          <Button
            variant="secondary"
            disabled={loadingMore}
            onClick={() => loadStudents({ term: search, pageCursor: nextCursor, append: true })}
          >
            {loadingMore ? 'Loading…' : 'Load more students'}
          </Button>
        </div>
      )}
      <section className="page-stack">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Immutable audit trail</span>
            <h2>Program assignment history</h2>
            <p>Every manual assignment records the administrator, previous state, selected Program Offering, and timestamp.</p>
          </div>
        </div>
        <DataTable
          columns={historyColumns}
          data={history}
          loading={loadingHistory}
          emptyMessage="No manual legacy-student assignments have been recorded."
        />
        {nextHistoryCursor && (
          <div className="table-actions">
            <Button
              variant="secondary"
              disabled={loadingHistory}
              onClick={() => loadHistory(nextHistoryCursor, true)}
            >
              {loadingHistory ? 'Loading…' : 'Load more history'}
            </Button>
          </div>
        )}
      </section>

      <Modal
        isOpen={Boolean(confirmation)}
        onClose={() => !busy && setConfirmation(null)}
        title="Confirm Program assignment"
        closeOnOverlayClick={false}
        footer={(
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button>
            <Button disabled={busy || !selectedOffering} onClick={assign}>
              {busy ? 'Assigning…' : 'Confirm assignment'}
            </Button>
          </>
        )}
      >
        {confirmation && selectedOffering ? (
          <div className="page-stack">
            <p>
              Assign <strong>{confirmation.student.firstName} {confirmation.student.lastName}</strong> to:
            </p>
            <section className="card">
              <h3>{selectedOffering.programme.title}</h3>
              <p>{formatOffering(selectedOffering)}</p>
            </section>
            <p>This creates one active Program enrollment and an immutable assignment history.</p>
          </div>
        ) : <p>Select a valid Program Offering before confirming.</p>}
      </Modal>
    </div>
  );
}
