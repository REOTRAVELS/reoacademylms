const KEY = 'reo-room-devices';

export const loadDevices = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
};

export const saveDevices = (patch) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadDevices(), ...patch }));
  } catch { /* storage can be unavailable (private mode); preferences just will not persist */ }
};
