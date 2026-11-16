import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Loader2, Mic, MicOff, Video, VideoOff,
} from 'lucide-react';
import { loadDevices, saveDevices } from './deviceStorage.js';
import { avatarTone, initialsOf } from './participantMeta.js';
import { friendlyMediaError } from './mediaErrors.js';

const supportsSink = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
const pick = (list, wanted) => (list.some((d) => d.deviceId === wanted) ? wanted : '');

export default function PreJoinLobby({
  liveClass, user, canPublish, joining, error, onJoin, onBack,
}) {
  const stored = useRef(loadDevices()).current;
  const [micOn, setMicOn] = useState(canPublish);
  const [camOn, setCamOn] = useState(canPublish);
  const [devices, setDevices] = useState({ audioinput: [], videoinput: [], audiooutput: [] });
  const [selected, setSelected] = useState({ audioInput: '', videoInput: '', audioOutput: '' });
  const [problems, setProblems] = useState({});
  const [level, setLevel] = useState(0);
  const videoRef = useRef(null);
  const camStream = useRef(null);
  const micStream = useRef(null);

  const stop = (ref) => { ref.current?.getTracks().forEach((t) => t.stop()); ref.current = null; };

  const refreshDevices = useCallback(async () => {
    const list = await navigator.mediaDevices.enumerateDevices();
    const next = {
      audioinput: list.filter((d) => d.kind === 'audioinput' && d.deviceId),
      videoinput: list.filter((d) => d.kind === 'videoinput' && d.deviceId),
      audiooutput: list.filter((d) => d.kind === 'audiooutput' && d.deviceId),
    };
    setDevices(next);
    setSelected((cur) => ({
      audioInput: pick(next.audioinput, cur.audioInput || stored.audioInput) || next.audioinput[0]?.deviceId || '',
      videoInput: pick(next.videoinput, cur.videoInput || stored.videoInput) || next.videoinput[0]?.deviceId || '',
      audioOutput: pick(next.audiooutput, cur.audioOutput || stored.audioOutput) || '',
    }));
  }, [stored]);

  // Camera preview: real getUserMedia stream, restarted only when the camera or its device changes.
  useEffect(() => {
    if (!canPublish || !camOn) { stop(camStream); if (videoRef.current) videoRef.current.srcObject = null; return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const constraints = { video: selected.videoInput ? { deviceId: { exact: selected.videoInput } } : true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        stop(camStream);
        camStream.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setProblems((p) => ({ ...p, camera: '' }));
        await refreshDevices();
      } catch (e) {
        if (cancelled) return;
        setProblems((p) => ({ ...p, camera: friendlyMediaError(e, 'camera') }));
        setCamOn(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canPublish, camOn, selected.videoInput, refreshDevices]);

  // Microphone: stream only feeds the level meter so people can see that it works.
  useEffect(() => {
    if (!canPublish || !micOn) { stop(micStream); setLevel(0); return undefined; }
    let cancelled = false;
    let frame; let ctx;
    (async () => {
      try {
        const constraints = { audio: selected.audioInput ? { deviceId: { exact: selected.audioInput } } : true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        stop(micStream);
        micStream.current = stream;
        let meterProblem = '';
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) throw new Error('Audio metering is not supported.');
          ctx = new AudioContextClass();
          if (ctx.state === 'suspended') await ctx.resume();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          ctx.createMediaStreamSource(stream).connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i] - 128));
            setLevel(Math.min(1, peak / 60));
            frame = requestAnimationFrame(tick);
          };
          tick();
          if (ctx.state !== 'running') meterProblem = 'The microphone is on, but the browser has paused its level meter.';
        } catch {
          meterProblem = 'The microphone is on, but its level meter could not start.';
        }
        setProblems((p) => ({ ...p, microphone: meterProblem }));
        await refreshDevices();
      } catch (e) {
        if (cancelled) return;
        setProblems((p) => ({ ...p, microphone: friendlyMediaError(e, 'microphone') }));
        setMicOn(false);
      }
    })();
    return () => { cancelled = true; cancelAnimationFrame(frame); ctx?.close().catch(() => {}); };
  }, [canPublish, micOn, selected.audioInput, refreshDevices]);

  useEffect(() => {
    refreshDevices().catch(() => {});
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
      stop(camStream); stop(micStream);
    };
  }, [refreshDevices]);

  const join = () => {
    stop(camStream); stop(micStream); // release devices so LiveKit can take them
    saveDevices({
      audioInput: selected.audioInput, videoInput: selected.videoInput, audioOutput: selected.audioOutput,
    });
    onJoin({
      audioEnabled: micOn, videoEnabled: camOn, ...selected,
    });
  };

  const name = `${user.firstName} ${user.lastName}`.trim();
  const select = (label, key, list) => (list.length > 0 && (
    <label className="rt-field">
      <span>{label}</span>
      <select value={selected[key]} onChange={(e) => setSelected((c) => ({ ...c, [key]: e.target.value }))}>
        {list.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>)}
      </select>
    </label>
  ));

  return (
    <div className="rt-screen rt-lobby">
      <button type="button" className="rt-lobby-back" onClick={onBack}><ArrowLeft size={16} /> Live classes</button>
      <div className="rt-lobby-grid">
        <div className="rt-preview">
          <div className="rt-preview-frame">
            {camOn && canPublish
              ? <video ref={videoRef} autoPlay playsInline muted className="rt-video is-mirrored" />
              : (
                <div className="rt-avatar-wrap">
                  <span className="rt-avatar rt-avatar--lg" style={{ '--tone': avatarTone(user.id) }}>{initialsOf(name)}</span>
                  <p>{canPublish ? 'Camera is off' : 'You will join with your camera and microphone off'}</p>
                </div>
              )}
            <div className="rt-preview-controls">
              <button
                type="button"
                className={`rt-round${micOn ? '' : ' is-off'}`}
                disabled={!canPublish}
                onClick={() => setMicOn((v) => !v)}
                aria-label={micOn ? 'Turn off microphone' : 'Turn on microphone'}
                aria-pressed={!micOn}
              >
                {micOn ? <Mic size={19} /> : <MicOff size={19} />}
              </button>
              <button
                type="button"
                className={`rt-round${camOn ? '' : ' is-off'}`}
                disabled={!canPublish}
                onClick={() => setCamOn((v) => !v)}
                aria-label={camOn ? 'Turn off camera' : 'Turn on camera'}
                aria-pressed={!camOn}
              >
                {camOn ? <Video size={19} /> : <VideoOff size={19} />}
              </button>
            </div>
            {micOn && canPublish && (
              <div className="rt-meter" role="img" aria-label="Microphone level">
                <span style={{ transform: `scaleX(${level})` }} />
              </div>
            )}
          </div>
          {Object.values(problems).filter(Boolean).map((text) => (
            <p className="rt-alert" role="alert" key={text}><AlertTriangle size={15} /> {text}</p>
          ))}
        </div>

        <div className="rt-lobby-side">
          <p className="rt-lobby-kicker">{liveClass.status === 'LIVE' ? 'Live now' : 'Ready to join'}</p>
          <h1>{liveClass.title}</h1>
          <p className="rt-lobby-sub">
            {[liveClass.course?.title, liveClass.cohort?.name].filter(Boolean).join(' · ') || 'Instant class'}
          </p>
          <p className="rt-lobby-name">Joining as <strong>{name}</strong></p>

          {canPublish ? (
            <div className="rt-lobby-devices">
              {select('Microphone', 'audioInput', devices.audioinput)}
              {select('Camera', 'videoInput', devices.videoinput)}
              {supportsSink && select('Speaker', 'audioOutput', devices.audiooutput)}
            </div>
          ) : (
            <p className="rt-panel-note">
              The host controls who can speak. Once you are in, raise your hand to ask for the floor.
            </p>
          )}

          {error && <p className="rt-alert" role="alert"><AlertTriangle size={15} /> {error}</p>}

          <button type="button" className="rt-btn rt-btn--primary rt-btn--lg" onClick={join} disabled={joining}>
            {joining ? <><Loader2 size={17} className="rt-spin" /> Joining…</> : 'Join class'}
          </button>
        </div>
      </div>
    </div>
  );
}
