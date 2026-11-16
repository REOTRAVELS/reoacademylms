// Mirrors the server's isLiveClassJoinable(). The server stays authoritative: this only
// decides what the UI offers, and the join request is still rejected server-side if wrong.
export const JOIN_WINDOW_MINS = 40;

export const classEnd = (liveClass) => (
  new Date(liveClass.startsAt).getTime() + Number(liveClass.durationMins || 60) * 60_000
);

export const opensAt = (liveClass) => new Date(new Date(liveClass.startsAt).getTime() - JOIN_WINDOW_MINS * 60_000);

// 'live' | 'open' | 'soon' | 'over'
export const joinState = (liveClass, now = Date.now()) => {
  if (['ENDED', 'CANCELLED'].includes(liveClass.status)) return 'over';
  if (liveClass.status === 'LIVE') return 'live';
  if (now >= classEnd(liveClass)) return 'over';
  if (now >= opensAt(liveClass).getTime()) return 'open';
  return 'soon';
};

export const canJoin = (liveClass, now) => ['live', 'open'].includes(joinState(liveClass, now));

export const untilLabel = (target, now = Date.now()) => {
  const mins = Math.max(0, Math.ceil((new Date(target).getTime() - now) / 60_000));
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60 ? `${mins % 60}m` : ''}`.trim();
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
};
