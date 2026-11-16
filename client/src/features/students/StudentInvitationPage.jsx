import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Copy, GraduationCap, Mail } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/forms/Input';
import { authAPI } from '../../services/api';

export default function StudentInvitationPage() {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [invitationUrl, setInvitationUrl] = useState('');
  const [sending, setSending] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setNotice('Student invitation link copied.');
    } catch {
      setNotice('Clipboard access is unavailable. Select and copy the invitation link below.');
    }
  };

  const createInvitation = async (event) => {
    event.preventDefault();
    setSending(true);
    setError('');
    setNotice('');
    setInvitationUrl('');
    try {
      const { data } = await authAPI.createInvitation({ email, role: 'STUDENT' });
      setInvitationUrl(data.data.invitationUrl || `${window.location.origin}/accept-invite/${data.data.token}`);
      setEmail('');
      setNotice(data.data.emailStatus === 'sent' || data.data.emailSent
        ? 'Invitation emailed to the student. You can also copy the secure link below.'
        : data.data.emailStatus === 'failed'
          ? 'Invitation created, but the email provider failed to send it. Copy the link below and check Vercel logs.'
          : 'Invitation created, but email is not configured. Add the email settings in Vercel, or copy the link below.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not create the student invitation.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-stack invitation-page">
      <Link className="back-link" to="/students"><ArrowLeft size={16} /> Student directory</Link>
      <section className="page-heading">
        <div>
          <span className="eyebrow">People &amp; access</span>
          <h1>Invite a student</h1>
          <p>Send a one-time invitation so the student can set a password and create their account.</p>
        </div>
      </section>
      <section className="card invite-card">
        <div className="invite-intro">
          <span className="invite-illustration"><GraduationCap size={27} /></span>
          <div>
            <h2>Student invitation</h2>
            <p>Students must have an approved Program application and active enrollment before accessing academic resources.</p>
          </div>
        </div>
        {notice && <div className="notice notice-success" role="status">{notice}</div>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {invitationUrl && (
          <div className="invite-link">
            <input
              readOnly
              value={invitationUrl}
              aria-label="Student invitation link"
              onFocus={(event) => event.target.select()}
            />
            <Button variant="secondary" onClick={copyLink}><Copy size={15} /> Copy link</Button>
          </div>
        )}
        <form className="invite-form" onSubmit={createInvitation}>
          <Input
            label="Student email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={setEmail}
            placeholder="student@example.com"
          />
          <Button type="submit" disabled={sending}>
            <Mail size={15} /> {sending ? 'Creating invitation…' : 'Create invitation'}
          </Button>
        </form>
      </section>
    </div>
  );
}
