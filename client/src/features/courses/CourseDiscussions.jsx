import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Flag,
  Lock,
  MessageSquare,
  Pin,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  Pencil,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/common/Button';
import { courseDiscussionsAPI } from '../../services/api';
import './courseDiscussions.css';

const errorText = (error, fallback) => error.response?.data?.message || fallback;
const authorName = (author) => `${author?.firstName || ''} ${author?.lastName || ''}`.trim() || 'Academy member';
const formatTimestamp = (value) => new Date(value).toLocaleString();
const topicLimit = 15;
const replyLimit = 10;

const initialReportDraft = { reason: 'SPAM', details: '' };
const initialTopicDraft = { title: '', body: '', isAnnouncement: false, attachToLesson: false };

function PostAuthor({ author, createdAt, editedAt }) {
  const name = authorName(author);
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <div className="discussion-author">
      <span className="discussion-avatar" aria-hidden="true">{initials}</span>
      <span className="discussion-author-copy">
        <strong>{name}</strong>
        <span>
          <time dateTime={createdAt}>{formatTimestamp(createdAt)}</time>
          {editedAt && <span className="discussion-edited"> · edited</span>}
        </span>
      </span>
      {author?.role?.name === 'TRAINER' && <span className="discussion-author-role">Tutor</span>}
      {author?.role?.name === 'SUPER_ADMIN' && <span className="discussion-author-role">Administrator</span>}
    </div>
  );
}

function ReportPostForm({ onCancel, onSubmit, saving }) {
  const [draft, setDraft] = useState(initialReportDraft);
  return (
    <form className="discussion-report-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit(draft);
    }}>
      <label>
        <span>Why are you reporting this post?</span>
        <select value={draft.reason} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))}>
          <option value="SPAM">Spam or advertising</option>
          <option value="HARASSMENT">Harassment or harmful language</option>
          <option value="PERSONAL_INFORMATION">Personal information</option>
          <option value="OTHER">Something else</option>
        </select>
      </label>
      <label>
        <span>Additional context <small>(optional)</small></span>
        <textarea maxLength={1000} rows={3} value={draft.details} onChange={(event) => setDraft((current) => ({ ...current, details: event.target.value }))} />
      </label>
      <div className="discussion-inline-actions">
        <Button type="submit" size="sm" disabled={saving}><Flag size={14} /> {saving ? 'Sending…' : 'Send report'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export default function CourseDiscussions({ courseId, courseTitle, selectedLesson, role }) {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [items, setItems] = useState([]);
  const [offerings, setOfferings] = useState([]);
  const [selectedOfferingId, setSelectedOfferingId] = useState('');
  const [permissions, setPermissions] = useState({ canModerate: false, canCreateAnnouncement: false });
  const [nextCursor, setNextCursor] = useState(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [topicDraft, setTopicDraft] = useState(initialTopicDraft);
  const [openPostId, setOpenPostId] = useState('');
  const [repliesByPost, setRepliesByPost] = useState({});
  const [replyCursors, setReplyCursors] = useState({});
  const [replyDrafts, setReplyDrafts] = useState({});
  const [editing, setEditing] = useState(null);
  const [reportingPostId, setReportingPostId] = useState('');
  const [reportedPostIds, setReportedPostIds] = useState(() => new Set());
  const [activePanel, setActivePanel] = useState('topics');
  const [reports, setReports] = useState([]);
  const [history, setHistory] = useState([]);
  const [moderationReason, setModerationReason] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [reviewDrafts, setReviewDrafts] = useState({});

  const loadTopics = useCallback(async (cursor = null, append = false, quiet = false) => {
    if (append) setLoadingMore(true);
    else if (!quiet) setLoading(true);
    setError('');
    try {
      const params = { limit: topicLimit, search };
      if (cursor) params.cursor = cursor;
      if (selectedOfferingId) params.programOfferingId = selectedOfferingId;
      const { data } = await courseDiscussionsAPI.list(courseId, params);
      const page = data.data;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
      setOfferings(page.offerings || []);
      setPermissions(page.permissions || { canModerate: false, canCreateAnnouncement: false });
      if (!selectedOfferingId && page.offerings?.length === 1) setSelectedOfferingId(page.offerings[0].id);
      return true;
    } catch (requestError) {
      setError(errorText(requestError, 'Could not load course discussions.'));
      return false;
    } finally {
      if (!quiet) setLoading(false);
      setLoadingMore(false);
    }
  }, [courseId, search, selectedOfferingId]);

  useEffect(() => { loadTopics(); }, [loadTopics]);

  const loadReplies = useCallback(async (postId, cursor = null, append = false) => {
    setError('');
    try {
      const params = { limit: replyLimit };
      if (cursor) params.cursor = cursor;
      const { data } = await courseDiscussionsAPI.replies(postId, params);
      const page = data.data;
      setRepliesByPost((current) => ({
        ...current,
        [postId]: append ? [...(current[postId] || []), ...page.items] : page.items,
      }));
      setReplyCursors((current) => ({ ...current, [postId]: page.nextCursor }));
      return true;
    } catch (requestError) {
      setError(errorText(requestError, 'Could not load replies.'));
      return false;
    }
  }, []);

  useEffect(() => {
    if (activePanel !== 'topics') return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadTopics(null, false, true);
        if (openPostId) loadReplies(openPostId);
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activePanel, loadTopics, loadReplies, openPostId]);

  const loadReports = async () => {
    setError('');
    try {
      const { data } = await courseDiscussionsAPI.reports({
        courseId,
        status: 'OPEN',
        ...(selectedOfferingId ? { programOfferingId: selectedOfferingId } : {}),
      });
      setReports(data.data.items || []);
    } catch (requestError) {
      setError(errorText(requestError, 'Could not load reported posts.'));
    }
  };

  const loadHistory = async () => {
    setError('');
    try {
      const { data } = await courseDiscussionsAPI.moderationHistory({
        courseId,
        ...(selectedOfferingId ? { programOfferingId: selectedOfferingId } : {}),
      });
      setHistory(data.data.items || []);
    } catch (requestError) {
      setError(errorText(requestError, 'Could not load moderation history.'));
    }
  };

  const refresh = async () => {
    if (activePanel === 'reports') await loadReports();
    else if (activePanel === 'history') await loadHistory();
    else await Promise.all([
      loadTopics(),
      ...(openPostId ? [loadReplies(openPostId)] : []),
    ]);
  };

  const submitSearch = (event) => {
    event.preventDefault();
    setOpenPostId('');
    setSearch(searchDraft.trim());
  };

  const createTopic = async (event) => {
    event.preventDefault();
    if (!selectedOfferingId) {
      setError('Select a Program Offering before starting a discussion.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await courseDiscussionsAPI.create(courseId, {
        title: topicDraft.title,
        body: topicDraft.body,
        programOfferingId: selectedOfferingId,
        ...(topicDraft.attachToLesson && selectedLesson?.id ? { lessonId: selectedLesson.id } : {}),
        isAnnouncement: Boolean(topicDraft.isAnnouncement),
      });
      setTopicDraft(initialTopicDraft);
      setNotice(topicDraft.isAnnouncement ? 'Tutor announcement posted.' : 'Discussion topic posted.');
      await loadTopics();
    } catch (requestError) {
      setError(errorText(requestError, 'Could not create this discussion.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleReplies = async (postId) => {
    if (openPostId === postId) {
      setOpenPostId('');
      return;
    }
    setOpenPostId(postId);
    await loadReplies(postId);
  };

  const submitReply = async (event, postId) => {
    event.preventDefault();
    const body = replyDrafts[postId] || '';
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await courseDiscussionsAPI.reply(postId, { body });
      setReplyDrafts((current) => ({ ...current, [postId]: '' }));
      await Promise.all([loadReplies(postId), loadTopics()]);
      setNotice('Your reply was added.');
    } catch (requestError) {
      setError(errorText(requestError, 'Could not add your reply.'));
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      await courseDiscussionsAPI.updatePost(editing.id, {
        ...(editing.type === 'TOPIC' ? { title: editing.title } : {}),
        body: editing.body,
      });
      setEditing(null);
      if (editing.type === 'REPLY' && openPostId) await loadReplies(openPostId);
      await loadTopics();
      setNotice('Your post was updated.');
    } catch (requestError) {
      setError(errorText(requestError, 'Could not update your post.'));
    } finally {
      setSaving(false);
    }
  };

  const removeOwnPost = async (post) => {
    if (!window.confirm('Remove this post? The conversation will show that it was removed.')) return;
    setSaving(true);
    setError('');
    try {
      await courseDiscussionsAPI.removePost(post.id);
      if (post.type === 'REPLY' && openPostId) await loadReplies(openPostId);
      await loadTopics();
      setNotice('Post removed.');
    } catch (requestError) {
      setError(errorText(requestError, 'Could not remove this post.'));
    } finally {
      setSaving(false);
    }
  };

  const applyModeration = async (postId, action, reason = undefined) => {
    setSaving(true);
    setError('');
    try {
      await courseDiscussionsAPI.moderate(postId, { action, ...(reason ? { reason } : {}) });
      setPendingRemoval(null);
      setModerationReason('');
      await Promise.all([loadTopics(), activePanel === 'history' ? loadHistory() : Promise.resolve()]);
      setNotice('Discussion status updated.');
    } catch (requestError) {
      setError(errorText(requestError, 'Could not update this discussion.'));
    } finally {
      setSaving(false);
    }
  };

  const submitReport = async (postId, draft) => {
    setSaving(true);
    setError('');
    try {
      await courseDiscussionsAPI.report(postId, draft);
      setReportedPostIds((current) => new Set(current).add(postId));
      setReportingPostId('');
      setNotice('Thank you. Your report was sent to the course moderation team.');
    } catch (requestError) {
      setError(errorText(requestError, 'Could not submit this report.'));
    } finally {
      setSaving(false);
    }
  };

  const reviewReport = async (report, draft) => {
    const review = draft || reviewDrafts[report.id] || { status: 'DISMISSED', reason: '', removePost: false };
    setSaving(true);
    setError('');
    try {
      await courseDiscussionsAPI.reviewReport(report.id, review);
      await Promise.all([loadReports(), loadHistory()]);
      setNotice('Report review saved.');
    } catch (requestError) {
      setError(errorText(requestError, 'Could not review this report.'));
    } finally {
      setSaving(false);
    }
  };

  const offeringLabel = (offering) => {
    const intake = offering.intake;
    return intake
      ? `Gate ${String(intake.gateNumber).padStart(2, '0')} · ${intake.season} ${intake.year}`
      : 'Program Offering';
  };

  const isOwner = (post) => post.authorId === currentUserId || post.author?.id === currentUserId;
  const refreshPanel = (panel) => {
    setActivePanel(panel);
    if (panel === 'reports') loadReports();
    if (panel === 'history') loadHistory();
  };

  return (
    <section className="course-discussions" aria-labelledby="course-discussions-title">
      <header className="discussion-heading">
        <div>
          <span className="eyebrow">Learn together</span>
          <h2 id="course-discussions-title">Course discussions</h2>
          <p>Ask questions, share insights, and follow Tutor announcements for {courseTitle}.</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw size={15} /> Refresh
        </Button>
      </header>

      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {notice && <div className="notice notice-success" role="status">{notice}</div>}

      {offerings.length > 1 && (
        <label className="discussion-offering-select">
          <span>Program Offering</span>
          <select value={selectedOfferingId} onChange={(event) => {
            setSelectedOfferingId(event.target.value);
            setOpenPostId('');
            setRepliesByPost({});
          }}>
            <option value="">{role === 'STUDENT' ? 'All your enrolled offerings' : 'All assigned Program Offerings'}</option>
            {offerings.map((offering) => <option value={offering.id} key={offering.id}>{offeringLabel(offering)}</option>)}
          </select>
        </label>
      )}

      {permissions.canModerate && (
        <nav className="discussion-tabs" aria-label="Discussion tools">
          <button type="button" aria-pressed={activePanel === 'topics'} onClick={() => refreshPanel('topics')}>
            <MessageSquare size={15} /> Topics
          </button>
          <button type="button" aria-pressed={activePanel === 'reports'} onClick={() => refreshPanel('reports')}>
            <ShieldAlert size={15} /> Reports
          </button>
          <button type="button" aria-pressed={activePanel === 'history'} onClick={() => refreshPanel('history')}>
            <Check size={15} /> Moderation history
          </button>
        </nav>
      )}

      {activePanel === 'topics' && (
        <>
          {offerings.length === 0 && !loading && <div className="discussion-empty">
            <MessageSquare size={22} />
            <h3>No Program Offering is available for this course</h3>
            <p>Discussion access is limited to the course’s assigned Program Offerings.</p>
          </div>}

          <form className="discussion-search" onSubmit={submitSearch}>
            <label htmlFor="course-discussion-search">Search discussions</label>
            <div>
              <Search size={16} aria-hidden="true" />
              <input
                id="course-discussion-search"
                value={searchDraft}
                maxLength={100}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Search topics and messages"
              />
              <Button type="submit" size="sm">Search</Button>
            </div>
          </form>

          <form className="discussion-compose" onSubmit={createTopic}>
            <div className="discussion-compose-heading">
              <div><span className="eyebrow">{permissions.canCreateAnnouncement ? 'Tutor workspace' : 'Your course community'}</span><h3>Start a discussion</h3></div>
              <MessageSquare size={20} aria-hidden="true" />
            </div>
            <label>
              <span>Title</span>
              <input value={topicDraft.title} maxLength={160} minLength={5} required onChange={(event) => setTopicDraft((draft) => ({ ...draft, title: event.target.value }))} placeholder="What would you like to discuss?" />
            </label>
            <label>
              <span>Message</span>
              <textarea value={topicDraft.body} maxLength={10000} required rows={4} onChange={(event) => setTopicDraft((draft) => ({ ...draft, body: event.target.value }))} placeholder="Add enough detail to help your classmates and Tutor respond…" />
            </label>
            {offerings.length > 1 && !selectedOfferingId && <p className="discussion-hint">Choose an offering above before posting.</p>}
            {selectedLesson?.id && (
              <label className="discussion-checkbox">
                <input type="checkbox" checked={topicDraft.attachToLesson} onChange={(event) => setTopicDraft((draft) => ({ ...draft, attachToLesson: event.target.checked }))} />
                <span>Link this topic to “{selectedLesson.title}”</span>
              </label>
            )}
            {permissions.canCreateAnnouncement && <label className="discussion-checkbox">
              <input type="checkbox" checked={topicDraft.isAnnouncement} onChange={(event) => setTopicDraft((draft) => ({ ...draft, isAnnouncement: event.target.checked }))} />
              <span>Post as a Tutor announcement</span>
            </label>}
            <div className="discussion-compose-footer">
              <span>Posts are visible only to members of the selected Program Offering.</span>
              <Button type="submit" disabled={saving || loading || (offerings.length > 1 && !selectedOfferingId)}>
                <Send size={15} /> {saving ? 'Posting…' : 'Post topic'}
              </Button>
            </div>
          </form>

          <div className="discussion-topic-list" aria-live="polite">
            {loading ? <div className="discussion-loading" role="status">Loading course discussions…</div> : items.length === 0 ? (
              <div className="discussion-empty">
                <MessageSquare size={22} />
                <h3>{search ? 'No matching discussions' : 'Start the conversation'}</h3>
                <p>{search ? 'Try another search or clear the search field.' : 'There are no topics yet. Ask a question or share a useful idea with your course.'}</p>
                {search && <Button type="button" variant="ghost" size="sm" onClick={() => {
                  setSearchDraft('');
                  setSearch('');
                }}>Clear search</Button>}
              </div>
            ) : items.map((post) => (
              <article className={`discussion-topic${post.isPinned ? ' is-pinned' : ''}`} key={post.id}>
                <div className="discussion-topic-main">
                  <div className="discussion-topic-meta">
                    {post.isAnnouncement && <span className="discussion-badge is-announcement">Tutor announcement</span>}
                    {post.isPinned && <span className="discussion-badge"><Pin size={12} /> Pinned</span>}
                    {post.isLocked && <span className="discussion-badge"><Lock size={12} /> Locked</span>}
                    {post.isResolved && <span className="discussion-badge is-resolved"><Check size={12} /> Resolved</span>}
                    {post.lesson && <span className="discussion-badge">Lesson · {post.lesson.title}</span>}
                  </div>
                  {editing?.id === post.id ? (
                    <form className="discussion-edit-form" onSubmit={saveEdit}>
                      <input aria-label="Edit discussion title" value={editing.title} maxLength={160} onChange={(event) => setEditing((current) => ({ ...current, title: event.target.value }))} />
                      <textarea aria-label="Edit discussion message" value={editing.body} maxLength={10000} rows={4} onChange={(event) => setEditing((current) => ({ ...current, body: event.target.value }))} />
                      <div className="discussion-inline-actions">
                        <Button type="submit" size="sm" disabled={saving}>Save changes</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </form>
                  ) : <>
                    <h3>{post.title}</h3>
                    <p className="discussion-post-body">{post.body}</p>
                  </>}
                  <PostAuthor author={post.author} createdAt={post.createdAt} editedAt={post.editedAt} />
                </div>

                <div className="discussion-topic-actions">
                  <Button type="button" variant="ghost" size="sm" aria-expanded={openPostId === post.id} onClick={() => toggleReplies(post.id)}>
                    <MessageSquare size={14} /> {post.replyCount || 0} replies <ChevronDown size={14} />
                  </Button>
                  {isOwner(post) && !post.deletedAt && editing?.id !== post.id && <button className="icon-button" type="button" aria-label={`Edit ${post.title}`} onClick={() => setEditing({ id: post.id, type: post.type, title: post.title || '', body: post.body })}><Pencil size={14} /></button>}
                  {isOwner(post) && !post.deletedAt && <button className="icon-button action-danger" type="button" aria-label={`Remove ${post.title}`} onClick={() => removeOwnPost(post)} disabled={saving}><Trash2 size={14} /></button>}
                  {permissions.canModerate && !post.deletedAt && <>
                    <button className="icon-button" type="button" aria-label={post.isPinned ? 'Unpin discussion' : 'Pin discussion'} title={post.isPinned ? 'Unpin discussion' : 'Pin discussion'} onClick={() => applyModeration(post.id, post.isPinned ? 'UNPIN' : 'PIN')} disabled={saving}><Pin size={14} /></button>
                    <button className="icon-button" type="button" aria-label={post.isLocked ? 'Unlock discussion' : 'Lock discussion'} title={post.isLocked ? 'Unlock discussion' : 'Lock discussion'} onClick={() => applyModeration(post.id, post.isLocked ? 'UNLOCK' : 'LOCK')} disabled={saving}><Lock size={14} /></button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => applyModeration(post.id, post.isResolved ? 'REOPEN' : 'RESOLVE')} disabled={saving}>{post.isResolved ? 'Reopen' : 'Resolve'}</Button>
                    <Button type="button" variant="ghost" size="sm" className="action-danger" disabled={saving} onClick={() => {
                      setPendingRemoval({ ...post, action: 'REMOVE' });
                      setModerationReason('');
                    }}>Remove</Button>
                  </>}
                  {role === 'STUDENT' && !isOwner(post) && !reportedPostIds.has(post.id) && <button className="icon-button" type="button" aria-label={`Report ${post.title}`} title="Report post" onClick={() => setReportingPostId((current) => current === post.id ? '' : post.id)}><Flag size={14} /></button>}
                  {reportedPostIds.has(post.id) && <span className="discussion-report-sent">Reported</span>}
                </div>

                {reportingPostId === post.id && <ReportPostForm onCancel={() => setReportingPostId('')} onSubmit={(draft) => submitReport(post.id, draft)} saving={saving} />}

                {openPostId === post.id && <div className="discussion-replies">
                  {(repliesByPost[post.id] || []).map((reply) => (
                    <article className={`discussion-reply${reply.deletedAt ? ' is-removed' : ''}`} key={reply.id}>
                      {editing?.id === reply.id ? (
                        <form className="discussion-edit-form" onSubmit={saveEdit}>
                          <textarea aria-label="Edit reply" value={editing.body} maxLength={10000} rows={3} onChange={(event) => setEditing((current) => ({ ...current, body: event.target.value }))} />
                          <div className="discussion-inline-actions">
                            <Button type="submit" size="sm" disabled={saving}>Save changes</Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                          </div>
                        </form>
                      ) : <p className="discussion-post-body">{reply.body}</p>}
                      <PostAuthor author={reply.author} createdAt={reply.createdAt} editedAt={reply.editedAt} />
                      {isOwner(reply) && !reply.deletedAt && <div className="discussion-topic-actions">
                        {editing?.id !== reply.id && <button className="icon-button" type="button" aria-label="Edit reply" onClick={() => setEditing({ id: reply.id, type: reply.type, body: reply.body })}><Pencil size={14} /></button>}
                        <button className="icon-button action-danger" type="button" aria-label="Remove reply" onClick={() => removeOwnPost(reply)} disabled={saving}><Trash2 size={14} /></button>
                      </div>}
                      {role === 'STUDENT' && !isOwner(reply) && !reply.deletedAt && !reportedPostIds.has(reply.id) && <button className="icon-button" type="button" aria-label="Report reply" onClick={() => setReportingPostId((current) => current === reply.id ? '' : reply.id)}><Flag size={14} /></button>}
                      {permissions.canModerate && !reply.deletedAt && <button className="icon-button action-danger" type="button" aria-label="Remove reply" disabled={saving} onClick={() => {
                        setPendingRemoval({ ...reply, action: 'REMOVE' });
                        setModerationReason('');
                      }}><Trash2 size={14} /></button>}
                      {reportingPostId === reply.id && <ReportPostForm onCancel={() => setReportingPostId('')} onSubmit={(draft) => submitReport(reply.id, draft)} saving={saving} />}
                    </article>
                  ))}
                  {replyCursors[post.id] && <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => loadReplies(post.id, replyCursors[post.id], true)}>Load older replies</Button>}
                  {!post.isLocked && !post.deletedAt ? <form className="discussion-reply-form" onSubmit={(event) => submitReply(event, post.id)}>
                    <label className="sr-only" htmlFor={`reply-${post.id}`}>Write a reply</label>
                    <textarea id={`reply-${post.id}`} rows={2} maxLength={10000} required placeholder="Write a thoughtful reply…" value={replyDrafts[post.id] || ''} onChange={(event) => setReplyDrafts((current) => ({ ...current, [post.id]: event.target.value }))} />
                    <Button type="submit" size="sm" disabled={saving}><Send size={14} /> Reply</Button>
                  </form> : <p className="discussion-locked-note"><Lock size={14} /> This discussion is locked.</p>}
                </div>}
              </article>
            ))}
            {nextCursor && <div className="discussion-load-more">
              <Button type="button" variant="secondary" onClick={() => loadTopics(nextCursor, true)} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more topics'}
              </Button>
            </div>}
          </div>
        </>
      )}

      {activePanel === 'reports' && permissions.canModerate && <section className="discussion-moderation-panel" aria-label="Reported posts">
        <div className="discussion-panel-heading"><h3>Reported posts</h3><span>{reports.length} open</span></div>
        {reports.length ? reports.map((report) => {
          const draft = reviewDrafts[report.id] || { status: 'DISMISSED', reason: '', removePost: false };
          return <article className="discussion-report-card" key={report.id}>
            <div><span className="discussion-badge"><Flag size={12} /> {report.reason.replaceAll('_', ' ')}</span><p>{report.details || 'No extra details supplied.'}</p></div>
            <blockquote>{report.post.title || 'Reply'}: {report.post.body}</blockquote>
            <PostAuthor author={report.reporter} createdAt={report.createdAt} />
            <label className="discussion-checkbox">
              <input type="checkbox" checked={draft.removePost} onChange={(event) => setReviewDrafts((current) => ({ ...current, [report.id]: { ...draft, removePost: event.target.checked } }))} />
              <span>Remove this content</span>
            </label>
            <label>
              <span>Resolution note {draft.removePost && '(required)'}</span>
              <textarea rows={2} maxLength={500} value={draft.reason} onChange={(event) => setReviewDrafts((current) => ({ ...current, [report.id]: { ...draft, reason: event.target.value } }))} />
            </label>
            <div className="discussion-inline-actions">
              <Button type="button" size="sm" disabled={saving} onClick={() => {
                const review = { ...draft, status: 'ACTIONED' };
                setReviewDrafts((current) => ({ ...current, [report.id]: review }));
                reviewReport(report, review);
              }}>Action report</Button>
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => {
                const review = { ...draft, status: 'DISMISSED' };
                setReviewDrafts((current) => ({ ...current, [report.id]: review }));
                reviewReport(report, review);
              }}>Dismiss</Button>
            </div>
          </article>;
        }) : <div className="discussion-empty"><ShieldAlert size={22} /><h3>No open reports</h3><p>Reported course content will appear here for review.</p></div>}
      </section>}

      {activePanel === 'history' && permissions.canModerate && <section className="discussion-moderation-panel" aria-label="Moderation history">
        <div className="discussion-panel-heading"><h3>Moderation history</h3><span>{history.length} events</span></div>
        {history.length ? history.map((event, index) => <article className="discussion-history-row" key={event.id}>
          <div>
            <strong>{event.action.replaceAll('_', ' ')}</strong>
            <p>{event.post.title || event.post.body}</p>
            {event.reason && <small>{event.reason}</small>}
            {event.post.deletedAt && history.findIndex((entry) => entry.post.id === event.post.id) === index && (
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => {
                setPendingRemoval({ ...event.post, action: 'RESTORE' });
                setModerationReason('');
              }}>Restore removed content</Button>
            )}
          </div>
          <PostAuthor author={event.actor} createdAt={event.createdAt} />
        </article>) : <div className="discussion-empty"><Check size={22} /><h3>No moderation actions yet</h3><p>Pin, lock, resolve, or remove actions will be recorded here.</p></div>}
      </section>}

      {pendingRemoval && <div className="discussion-dialog-backdrop">
        <section className="discussion-dialog" role="dialog" aria-modal="true" aria-labelledby="discussion-remove-title">
          <h3 id="discussion-remove-title">{pendingRemoval.action === 'RESTORE' ? 'Restore discussion content?' : 'Remove discussion content?'}</h3>
          <p>{pendingRemoval.action === 'RESTORE'
            ? 'This content will be visible to members of its Program Offering again.'
            : 'This post will be hidden from the course, but retained in moderation history.'}</p>
          <label>
            <span>{pendingRemoval.action === 'RESTORE' ? 'Reason for restoration' : 'Reason for removal'}</span>
            <textarea rows={3} maxLength={500} value={moderationReason} onChange={(event) => setModerationReason(event.target.value)} />
          </label>
          <div className="discussion-inline-actions">
            <Button type="button" variant={pendingRemoval.action === 'RESTORE' ? 'primary' : 'danger'} disabled={saving || moderationReason.trim().length < 5} onClick={() => applyModeration(pendingRemoval.id, pendingRemoval.action, moderationReason.trim())}>
              {pendingRemoval.action === 'RESTORE' ? 'Restore content' : 'Remove content'}
            </Button>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setPendingRemoval(null)}>Cancel</Button>
          </div>
        </section>
      </div>}
    </section>
  );
}
