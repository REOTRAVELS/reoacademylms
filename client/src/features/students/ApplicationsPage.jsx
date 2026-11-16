import { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { applicationsAPI } from '../../services/api';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import { Button } from '../../components/common/Button';
import { Textarea } from '../../components/forms/Input';
import { Modal } from '../../components/common/Modal';
import DataTable from '../../components/tables/DataTable';

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : '—';

export default function ApplicationsPage() {
  const [applications, setApplications] = useState([]);
  const [filter, setFilter] = useState('PENDING');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [detail, setDetail] = useState({ open: false, loading: false, application: null, error: '' });
  const [rejectionReason, setRejectionReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await applicationsAPI.list({ status: filter });
      setApplications(data.data || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load Program applications.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const openDetails = async (application) => {
    setDetail({ open: true, loading: true, application: null, error: '' });
    try {
      const { data } = await applicationsAPI.get(application.id);
      setDetail({ open: true, loading: false, application: data.data, error: '' });
    } catch (requestError) {
      setDetail({
        open: true,
        loading: false,
        application: null,
        error: requestError.response?.data?.message || 'Could not load application details.',
      });
    }
  };

  const closeDetails = () => setDetail({ open: false, loading: false, application: null, error: '' });

  const approve = async (application) => {
    if (!window.confirm(`Approve ${application.student.firstName} ${application.student.lastName} for ${application.programOffering.programme.title}?`)) return;
    setBusyId(application.id);
    setError('');
    setNotice('');
    try {
      await applicationsAPI.approve(application.id);
      setNotice('Application approved and Program enrollment activated.');
      if (detail.application?.id === application.id) closeDetails();
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not approve this application.');
    } finally {
      setBusyId('');
    }
  };

  const reject = async (event) => {
    event.preventDefault();
    if (!selectedApplication || rejectionReason.trim().length < 3) return;
    setBusyId(selectedApplication.id);
    setError('');
    setNotice('');
    try {
      await applicationsAPI.reject(selectedApplication.id, { rejectionReason: rejectionReason.trim() });
      setNotice('Application rejected. The decision and reason have been recorded.');
      setSelectedApplication(null);
      setRejectionReason('');
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not reject this application.');
    } finally {
      setBusyId('');
    }
  };

  const columns = [
    {
      key: 'student',
      label: 'Applicant',
      render: (application) => (
        <div className="person-cell">
          <span className="person-avatar">{`${application.student.firstName?.[0] || ''}${application.student.lastName?.[0] || ''}`.toUpperCase()}</span>
          <span><strong>{application.student.firstName} {application.student.lastName}</strong><small>{application.student.email}</small></span>
        </div>
      ),
    },
    {
      key: 'program',
      label: 'Program',
      render: ({ programOffering }) => (
        <span><strong>{programOffering.programme.title}</strong><small>{programOffering.programme.qualificationType || 'Qualification not specified'}</small></span>
      ),
    },
    {
      key: 'intake',
      label: 'Intake',
      render: ({ programOffering }) => `GATE ${String(programOffering.intake.gateNumber).padStart(2, '0')} ${programOffering.intake.season} ${programOffering.intake.year}`,
    },
    { key: 'submittedAt', label: 'Submitted', render: (application) => formatDate(application.submittedAt) },
    { key: 'status', label: 'Status', render: (application) => <span className={statusClass(application.status)}>{statusLabel(application.status)}</span> },
    {
      key: 'actions',
      label: 'Actions',
      render: (application) => (
        <div className="table-actions">
          <Button variant="secondary" onClick={() => openDetails(application)} disabled={detail.loading}>Details</Button>
          {application.status === 'PENDING' && (
            <>
              <button className="icon-button action-success" disabled={busyId === application.id} onClick={() => approve(application)} title="Approve and enroll" aria-label="Approve and enroll"><Check size={16} /></button>
              <button className="icon-button action-danger" disabled={busyId === application.id} onClick={() => { setSelectedApplication(application); setRejectionReason(''); }} title="Reject application" aria-label="Reject application"><X size={16} /></button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Admissions</span>
          <h1>Program applications</h1>
          <p>Review each application for one Program and Intake. Approval creates one active Program enrollment.</p>
        </div>
      </section>

      <section className="directory-toolbar card">
        <div className="directory-summary"><strong>{applications.length}</strong><span>applications shown</span></div>
        <label className="field">
          <span className="label">Application status</span>
          <select className="select compact-select" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="ALL">All statuses</option>
          </select>
        </label>
      </section>

      {notice && <div className="notice notice-success" role="status">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <DataTable columns={columns} data={applications} loading={loading} emptyMessage="No Program applications match this status." />

      <Modal
        isOpen={detail.open}
        onClose={closeDetails}
        title="Application details"
        footer={detail.application?.status === 'PENDING' ? (
          <>
            <Button variant="ghost" onClick={closeDetails}>Close</Button>
            <Button variant="danger" onClick={() => {
              setSelectedApplication(detail.application);
              setRejectionReason('');
              closeDetails();
            }}>Reject application</Button>
            <Button onClick={() => approve(detail.application)}>Approve and enroll</Button>
          </>
        ) : <Button variant="ghost" onClick={closeDetails}>Close</Button>}
      >
        {detail.loading && <p role="status">Loading application details…</p>}
        {detail.error && <div className="notice notice-error" role="alert">{detail.error}</div>}
        {detail.application && (
          <div className="page-stack">
            <section>
              <h4>Applicant</h4>
              <p>{detail.application.student.firstName} {detail.application.student.lastName}</p>
              <p>{detail.application.student.email}</p>
              {detail.application.student.phone && <p>{detail.application.student.phone}</p>}
              <p>Account status: {detail.application.student.status}</p>
            </section>
            <section>
              <h4>Selected Program and Intake</h4>
              <p>{detail.application.programOffering.programme.title}</p>
              <p>
                GATE {String(detail.application.programOffering.intake.gateNumber).padStart(2, '0')}{' '}
                {detail.application.programOffering.intake.season} {detail.application.programOffering.intake.year}
              </p>
              <p>Application status: {detail.application.status}</p>
              <p>Submitted: {formatDate(detail.application.submittedAt)}</p>
              {detail.application.reviewedAt && <p>Reviewed: {formatDate(detail.application.reviewedAt)}</p>}
              {detail.application.reviewedBy && (
                <p>Reviewed by: {detail.application.reviewedBy.firstName} {detail.application.reviewedBy.lastName}</p>
              )}
              {detail.application.rejectionReason && <p>Rejection reason: {detail.application.rejectionReason}</p>}
              {detail.application.adminNotes && <p>Administrator notes: {detail.application.adminNotes}</p>}
            </section>
            <section>
              <h4>Status history</h4>
              {detail.application.history.length ? (
                <ul>
                  {detail.application.history.map((item) => (
                    <li key={item.id}>
                      {item.fromStatus ? `${item.fromStatus} → ` : ''}{item.toStatus} — {formatDate(item.createdAt)}
                      {item.changedBy && ` by ${item.changedBy.firstName} ${item.changedBy.lastName}`}
                      {item.reason ? `: ${item.reason}` : ''}
                    </li>
                  ))}
                </ul>
              ) : <p>No status history is available.</p>}
            </section>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(selectedApplication)}
        onClose={() => setSelectedApplication(null)}
        title="Reject Program application"
        closeOnOverlayClick={false}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setSelectedApplication(null)}>Cancel</Button>
            <Button variant="danger" type="submit" form="application-rejection-form" disabled={busyId === selectedApplication?.id || rejectionReason.trim().length < 3}>
              {busyId === selectedApplication?.id ? 'Saving…' : 'Reject application'}
            </Button>
          </>
        )}
      >
        <form id="application-rejection-form" onSubmit={reject}>
          <p>Provide a clear reason. It will be recorded in the application history and shown to the applicant.</p>
          <Textarea label="Reason for rejection" value={rejectionReason} onChange={setRejectionReason} required maxLength={2000} />
        </form>
      </Modal>
    </div>
  );
}
