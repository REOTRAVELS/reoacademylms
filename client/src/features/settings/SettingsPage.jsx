import { useState, useEffect } from 'react';
import { Camera, LockKeyhole, Save } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/common/Button';
import { Input, Textarea } from '../../components/forms/Input';
import { usersAPI } from '../../services/api';
import { roleLabel, statusLabel } from '../../components/common/navConfig';

const initialPasswordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', bio: '' });
  const [passwordForm, setPasswordForm] = useState(initialPasswordForm);
  const [loading, setLoading] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    if (user) {
      setForm({ firstName: user.firstName || '', lastName: user.lastName || '', phone: user.phone || '', bio: user.bio || '' });
    }
  }, [user]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!user) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await usersAPI.update(user.id, form);
      await refreshUser();
      setSuccess('Profile updated successfully.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to update profile.');
    } finally {
      setLoading(false);
    }
  };

  const uploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    setPhotoLoading(true);
    setError('');
    setSuccess('');
    try {
      await usersAPI.uploadAvatar(user.id, file);
      await refreshUser();
      setSuccess('Profile picture updated.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update your profile picture.');
    } finally {
      setPhotoLoading(false);
      event.target.value = '';
    }
  };

  const updatePassword = async (event) => {
    event.preventDefault();
    if (!user) return;
    setPasswordError('');
    setPasswordSuccess('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setPasswordLoading(true);
    try {
      await usersAPI.changePassword(user.id, {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm(initialPasswordForm);
      setPasswordSuccess('Password changed successfully.');
    } catch (requestError) {
      setPasswordError(requestError.response?.data?.message || 'Could not change your password.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const avatarSrc = usersAPI.avatarImageUrl(user?.avatarUrl);

  return (
    <div className="page-stack settings-page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Your account</span>
          <h1>Settings</h1>
          <p>Update your profile and secure your account.</p>
        </div>
      </section>

      <section className="card settings-card">
        <div className="card-heading">
          <div><span className="eyebrow">Personal details</span><h2>Profile information</h2></div>
        </div>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {success && <div className="notice notice-success" role="status">{success}</div>}

        <div className="profile-picture-control">
          {avatarSrc
            ? <img className="profile-picture" src={avatarSrc} alt={`${user?.firstName || 'Your'} profile`} />
            : <span className="profile-picture profile-picture-initials">{`${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'R'}</span>}
          <div>
            <strong>Profile picture</strong>
            <p className="muted small">PNG, JPEG, or WebP, up to 5 MB.</p>
            <label className="btn btn-secondary btn-sm profile-picture-upload">
              <Camera size={15} /> {photoLoading ? 'Uploading…' : 'Upload picture'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={uploadAvatar}
                disabled={photoLoading}
                aria-label="Upload profile picture"
              />
            </label>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="settings-form">
          <div className="assessment-form-grid">
            <Input label="First name" value={form.firstName} onChange={(firstName) => setForm((current) => ({ ...current, firstName }))} required maxLength={80} />
            <Input label="Last name" value={form.lastName} onChange={(lastName) => setForm((current) => ({ ...current, lastName }))} required maxLength={80} />
          </div>
          <Input label="Phone" value={form.phone} onChange={(phone) => setForm((current) => ({ ...current, phone }))} maxLength={40} />
          <Textarea label="About you" value={form.bio} onChange={(bio) => setForm((current) => ({ ...current, bio }))} maxLength={1000} />
          <Button type="submit" disabled={loading}><Save size={15} /> {loading ? 'Saving…' : 'Save profile'}</Button>
        </form>
      </section>

      <section className="card settings-card">
        <div className="card-heading">
          <div><span className="eyebrow">Account security</span><h2>Change password</h2></div>
          <LockKeyhole size={19} />
        </div>
        {passwordError && <div className="notice notice-error" role="alert">{passwordError}</div>}
        {passwordSuccess && <div className="notice notice-success" role="status">{passwordSuccess}</div>}
        <form onSubmit={updatePassword} className="settings-form">
          <Input label="Current password" type="password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={(currentPassword) => setPasswordForm((current) => ({ ...current, currentPassword }))} required />
          <Input label="New password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={passwordForm.newPassword} onChange={(newPassword) => setPasswordForm((current) => ({ ...current, newPassword }))} required />
          <Input label="Confirm new password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={passwordForm.confirmPassword} onChange={(confirmPassword) => setPasswordForm((current) => ({ ...current, confirmPassword }))} required />
          <Button type="submit" variant="secondary" disabled={passwordLoading}><LockKeyhole size={15} /> {passwordLoading ? 'Updating…' : 'Update password'}</Button>
        </form>
      </section>

      <section className="card settings-card">
        <div className="card-heading">
          <div><span className="eyebrow">Account details</span><h2>Account information</h2></div>
        </div>
        <div className="settings-account-grid">
          <Input label="Email" value={user?.email || ''} disabled readOnly />
          <Input label="Role (managed by your administrator)" value={roleLabel(role)} disabled readOnly />
          <Input label="Account status" value={statusLabel(user?.status)} disabled readOnly />
        </div>
      </section>
    </div>
  );
}
