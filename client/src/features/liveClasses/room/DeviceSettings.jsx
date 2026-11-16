import { useEffect, useRef } from 'react';
import { useMediaDeviceSelect } from '@livekit/components-react';
import { X } from 'lucide-react';
import { saveDevices } from './deviceStorage.js';

const FIELDS = [
  { kind: 'audioinput', label: 'Microphone', key: 'audioInput' },
  { kind: 'videoinput', label: 'Camera', key: 'videoInput' },
  { kind: 'audiooutput', label: 'Speaker', key: 'audioOutput' },
];

function DeviceSelect({ kind, label, storeKey, onError }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({
    kind,
    requestPermissions: false,
    onError: (error) => onError(error.message),
  });
  if (!devices.length) return null;
  return (
    <label className="rt-field">
      <span>{label}</span>
      <select
        value={activeDeviceId}
        onChange={async (event) => {
          const id = event.target.value;
          try {
            await setActiveMediaDevice(id);
            saveDevices({ [storeKey]: id });
          } catch (error) {
            onError(error.message || `Could not switch ${label.toLowerCase()}.`);
          }
        }}
      >
        {devices.map((device, i) => (
          <option key={device.deviceId || i} value={device.deviceId}>
            {device.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function DeviceSettings({ onClose, onError }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    dialogRef.current?.querySelector('select, button')?.focus();
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="rt-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rt-modal" role="dialog" aria-modal="true" aria-labelledby="rt-settings-title" ref={dialogRef}>
        <header className="rt-panel-head">
          <h2 id="rt-settings-title">Audio and video</h2>
          <button type="button" className="rt-icon-btn" onClick={onClose} aria-label="Close settings"><X size={18} /></button>
        </header>
        <div className="rt-modal-body">
          {FIELDS.map((f) => (
            <DeviceSelect key={f.kind} kind={f.kind} label={f.label} storeKey={f.key} onError={onError} />
          ))}
          <p className="rt-panel-note">Devices you pick here are remembered for your next class.</p>
        </div>
      </div>
    </div>
  );
}
