export const friendlyMediaError = (error, device = 'device') => {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return `Your browser is blocking the ${device}. Allow access in the address bar, then try again.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${device} was found. Check that it is plugged in.`;
  if (name === 'NotReadableError') return `Another app is using your ${device}. Close it and try again.`;
  if (/permission/i.test(error?.message || '')) return 'The host controls who can speak in this class.';
  return error?.message || `Could not start your ${device}.`;
};
