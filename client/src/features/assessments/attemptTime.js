export const getRemainingSeconds = (attempt, timeLimitMin, now = Date.now()) => {
  if (!timeLimitMin) return null;
  const startedAt = new Date(attempt.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, Math.ceil((startedAt + timeLimitMin * 60_000 - now) / 1000));
};

export const formatRemainingTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};
