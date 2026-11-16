import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Copy, GraduationCap, Mail } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/forms/Input';
import { authAPI } from '../../services/api';

export default function StudentInvitationPage() {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const registrationUrl = `${window.location.origin}/register`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(registrationUrl);
      setNotice('Student application link copied.');
    } catch {
      setNotice('Clipboard access is unavailable. Select and copy the link below.');
    }
  };

  const sendApplicationLink = async (event) => {
    event.preventDefault();
    setSending(true);
    setNotice('');
    setError('');
    try {
      await authAPI.sendStudentApplicationLink({ email });
      setEmail('');
      setNotice('Student application link emailed.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not email the application link.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-stack invitation-page">
      <Link className="back-link" to="/students"><ArrowLeft size={16} /> Student directory</Link>
      <section className="page-heading">
        <div>
          <span className="eyebrow">Admissions</span>
          <h1>Student application link</h1>
          <p>Students choose one open Program and Intake when they apply. Staff invitations cannot activate student accounts.</p>
        </div>
      </section>
      <section className="card invite-card">
        <div className="invite-intro">
          <span className="invite-illustration"><GraduationCap size={27} /></span>
          <div><h2>Share the application form</h2><p>Applicants remain restricted from academic resources until their application is approved.</p></div>
        </div>
        {notice && <div className="notice notice-success" role="status">{notice}</div>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <div className="invite-link">
          <input readOnly value={registrationUrl} aria-label="Student application link" onFocus={(event) => event.target.select()} />
          <Button variant="secondary" onClick={copyLink}><Copy size={15} /> Copy link</Button>
        </div>
        <form className="invite-form" onSubmit={sendApplicationLink}>
          <Input
            label="Applicant email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={setEmail}
            placeholder="applicant@example.com"
          />
          <Button type="submit" disabled={sending}>
            <Mail size={15} /> {sending ? 'Sending…' : 'Email application link'}
          </Button>
        </form>
      </section>
    </div>
  );
}
