export const parseMetadata = (participant) => {
  try {
    return participant?.metadata ? JSON.parse(participant.metadata) : {};
  } catch {
    return {};
  }
};

export const isHostParticipant = (participant) => {
  const role = parseMetadata(participant).role;
  return role === 'TRAINER' || role === 'SUPER_ADMIN';
};

export const displayName = (participant) => (
  participant?.name?.trim() || participant?.identity || 'Participant'
);

export const initialsOf = (name = '') => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

// Reads canPublish from the join token so the lobby knows whether this person may use mic/camera.
export const tokenCanPublish = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Boolean(payload?.video?.canPublish);
  } catch {
    return false;
  }
};

const AVATAR_TONES = ['#2f7f79', '#8a6a2f', '#5a6fa8', '#8f4f6a', '#4f7f4a', '#7a5aa6', '#a8583f', '#3f7f95'];
export const avatarTone = (seed = '') => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
};

export const formatElapsed = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
