import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/common/Button';
import { notificationsAPI } from '../../services/api';

const typeFor = (notification) => {
  if (notification.audienceStatus === 'ARCHIVED') return 'ARCHIVED';
  if (notification.isGlobal) return 'GLOBAL';
  if (notification.programOfferingId) return 'OFFERING';
  if (notification.programmeId) return 'PROGRAMME';
  return '';
};

const classificationLabel = (classification, programmes, offerings) => {
  if (classification.audienceStatus === 'UNCLASSIFIED') return 'Unclassified — hidden from students';
  if (classification.audienceStatus === 'ARCHIVED') return 'Archived — preserved, hidden from students';
  if (classification.isGlobal) return 'Global';
  if (classification.programOfferingId) {
    const offering = offerings.find((item) => item.id === classification.programOfferingId);
    return offering ? `Offering: ${offeringLabel(offering)}` : `Offering: ${classification.programOfferingId}`;
  }
  if (classification.programmeId) {
    const programme = programmes.find((item) => item.id === classification.programmeId);
    return `Program: ${programme?.title || classification.programmeId}`;
  }
  return 'Unclassified';
};

const offeringLabel = (offering) => (
  `${offering.programme.title} — GATE ${String(offering.intake.gateNumber).padStart(2, '0')} ${offering.intake.season} ${offering.intake.year}`
);

export default function LegacyNotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [programmes, setProgrammes] = useState([]);
  const [offerings, setOfferings] = useState([]);
  const [choices, setChoices] = useState({});
  const [status, setStatus] = useState('UNCLASSIFIED');
  const [cursor, setCursor] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async ({ pageCursor = null, append = false } = {}) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await notificationsAPI.listLegacy({
        status,
        limit: 20,
        cursor: pageCursor || undefined,
      });
      setNotifications((current) => append ? [...current, ...data.data.items] : data.data.items);
      setCursor(pageCursor);
      setNextCursor(data.data.nextCursor);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load legacy notifications.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const loadOptions = async () => {
      try {
        const { data } = await notificationsAPI.legacyClassificationOptions();
        setProgrammes(data.data.programmes);
        setOfferings(data.data.offerings);
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'Could not load Program and Offering options.');
      }
    };
    void loadOptions();
  }, []);

  const getChoice = (notification) => choices[notification.id] || {
    audienceType: typeFor(notification),
    programmeId: notification.programmeId || '',
    programOfferingId: notification.programOfferingId || '',
  };

  const updateChoice = (notification, field, value) => {
    setChoices((current) => {
      const existing = current[notification.id] || getChoice(notification);
      const next = { ...existing, [field]: value };
      if (field === 'audienceType') {
        next.programmeId = '';
        next.programOfferingId = '';
      }
      return { ...current, [notification.id]: next };
    });
  };

  const classify = async (notification) => {
    const choice = getChoice(notification);
    const payload = { audienceType: choice.audienceType };
    if (choice.audienceType === 'PROGRAMME') payload.programmeId = choice.programmeId;
    if (choice.audienceType === 'OFFERING') payload.programOfferingId = choice.programOfferingId;
    setBusyId(notification.id);
    setError('');
    setNotice('');
    try {
      await notificationsAPI.classifyLegacy(notification.id, payload);
      setNotice(`Audience classification saved for "${notification.title}".`);
      setChoices((current) => {
        const next = { ...current };
        delete next[notification.id];
        return next;
      });
      await load({ pageCursor: cursor });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save this notification classification.');
    } finally {
      setBusyId('');
    }
  };

  const canSave = (notification) => {
    const choice = getChoice(notification);
    if (!choice.audienceType) return false;
    if (choice.audienceType === 'PROGRAMME') return Boolean(choice.programmeId);
    if (choice.audienceType === 'OFFERING') return Boolean(choice.programOfferingId);
    return true;
  };

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Communications governance</span>
          <h1>Legacy notification review</h1>
          <p>Historical notifications stay stored and hidden from students until an administrator explicitly classifies their audience.</p>
        </div>
      </section>

      {notice && <div className="notice notice-success" role="status">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}

      <section className="directory-toolbar card">
        <div className="directory-summary"><strong>{notifications.length}</strong><span>notifications shown</span></div>
        <label className="field">
          <span className="label">Review status</span>
          <select
            className="select compact-select"
            value={status}
            onChange={(event) => { setStatus(event.target.value); setCursor(null); }}
          >
            <option value="UNCLASSIFIED">Unclassified</option>
            <option value="CLASSIFIED">Classified</option>
            <option value="ARCHIVED">Archived</option>
            <option value="ALL">All records</option>
          </select>
        </label>
      </section>

      {loading && <p role="status">Loading notifications…</p>}
      {!loading && notifications.length === 0 && (
        <section className="card"><p>No notifications match this review status.</p></section>
      )}
      {notifications.map((notification) => {
        const choice = getChoice(notification);
        const needsProgramme = choice.audienceType === 'PROGRAMME';
        const needsOffering = choice.audienceType === 'OFFERING';
        const history = notification.classificationHistory || [];
        return (
          <article className="card page-stack" key={notification.id}>
            <header>
              <span className="eyebrow">{notification.type} · {new Date(notification.createdAt).toLocaleString()}</span>
              <h2>{notification.title}</h2>
              <p>Recipient: {notification.user.firstName} {notification.user.lastName} · {notification.user.email}</p>
              <p>Current audience: <strong>{classificationLabel(notification, programmes, offerings)}</strong></p>
            </header>
            {notification.body && <p className="notification-legacy-body">{notification.body}</p>}

            <div className="intake-form-grid">
              <label className="field">
                <span className="label">Audience classification</span>
                <select
                  className="select"
                  aria-label={`Audience classification for ${notification.title}`}
                  value={choice.audienceType}
                  onChange={(event) => updateChoice(notification, 'audienceType', event.target.value)}
                >
                  <option value="">Choose classification</option>
                  <option value="GLOBAL">Global</option>
                  <option value="PROGRAMME">Program-specific</option>
                  <option value="OFFERING">Offering-specific</option>
                  <option value="ARCHIVED">Archive — preserve and hide from students</option>
                </select>
              </label>
              {needsProgramme && (
                <label className="field">
                  <span className="label">Program</span>
                  <select
                    className="select"
                    aria-label={`Program for ${notification.title}`}
                    value={choice.programmeId}
                    onChange={(event) => updateChoice(notification, 'programmeId', event.target.value)}
                  >
                    <option value="">Select a Program</option>
                    {programmes.map((programme) => (
                      <option key={programme.id} value={programme.id}>{programme.title}</option>
                    ))}
                  </select>
                </label>
              )}
              {needsOffering && (
                <label className="field">
                  <span className="label">Program Offering</span>
                  <select
                    className="select"
                    aria-label={`Program Offering for ${notification.title}`}
                    value={choice.programOfferingId}
                    onChange={(event) => updateChoice(notification, 'programOfferingId', event.target.value)}
                  >
                    <option value="">Select a Program Offering</option>
                    {offerings.map((offering) => (
                      <option key={offering.id} value={offering.id}>{offeringLabel(offering)}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="table-actions">
              <Button
                disabled={!canSave(notification) || busyId === notification.id}
                onClick={() => classify(notification)}
              >
                {busyId === notification.id ? 'Saving…' : 'Save classification'}
              </Button>
            </div>
            {history.length > 0 && (
              <section>
                <h3>Classification history</h3>
                <ul>
                  {history.map((item) => (
                    <li key={item.id}>
                      {classificationLabel(item.previousClassification, programmes, offerings)} → {classificationLabel(item.newClassification, programmes, offerings)}
                      {' — '}{new Date(item.changedAt).toLocaleString()}
                      {item.changedBy && ` by ${item.changedBy.firstName} ${item.changedBy.lastName}`}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </article>
        );
      })}
      {nextCursor && (
        <div className="table-actions">
          <Button variant="secondary" disabled={loading} onClick={() => load({ pageCursor: nextCursor, append: true })}>
            Load more notifications
          </Button>
        </div>
      )}
    </div>
  );
}
