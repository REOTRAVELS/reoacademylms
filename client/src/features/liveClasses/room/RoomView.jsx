import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  LiveKitRoom, RoomAudioRenderer, useConnectionState, useLocalParticipant, useParticipants,
} from '@livekit/components-react';
import { ConnectionState, DisconnectReason, VideoPresets } from 'livekit-client';
import {
  Copy, Info, Loader2, Maximize, Minimize, MonitorX, Radio, RefreshCw, Settings, Square, Users, PhoneOff, WifiOff,
} from 'lucide-react';
import { liveClassesAPI } from '../../../services/api';
import MeetingHeader from './MeetingHeader.jsx';
import MeetingToolbar from './MeetingToolbar.jsx';
import VideoStage from './VideoStage.jsx';
import ChatPanel from './ChatPanel.jsx';
import ParticipantsPanel from './ParticipantsPanel.jsx';
import InfoPanel from './InfoPanel.jsx';
import DeviceSettings from './DeviceSettings.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import ReactionLayer, { useReactions } from './ReactionLayer.jsx';
import useClassroomSocket from './useClassroomSocket.js';
import { friendlyMediaError } from './mediaErrors.js';

const errorMessage = (error, fallback) => error?.response?.data?.message || error?.message || fallback;
const PANELS = ['chat', 'people', 'info'];

function RoomContent({
  liveClass, user, isHost, joinedAt, onLeave, onEnded, onEndClass,
}) {
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const [panel, setPanel] = useState(null);
  const [renderedPanel, setRenderedPanel] = useState('chat');
  const [toasts, setToasts] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [working, setWorking] = useState(false);
  const [recordings, setRecordings] = useState([]);
  const [seen, setSeen] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef(null);

  const notify = useCallback((text, tone = 'info') => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4500);
  }, []);

  const refreshRecordings = useCallback(async () => {
    try {
      const { data } = await liveClassesAPI.listRecordings(liveClass.id);
      setRecordings(data.data);
    } catch { /* recording state is informational; ignore */ }
  }, [liveClass.id]);

  const socket = useClassroomSocket({
    liveClassId: liveClass.id,
    userId: user.id,
    onNotice: notify,
    onRecording: (event) => { if (event?.notice) notify(event.notice); refreshRecordings(); },
    onEnded,
  });
  const reactions = useReactions();

  useEffect(() => { refreshRecordings(); const t = window.setInterval(refreshRecordings, 30000); return () => window.clearInterval(t); }, [refreshRecordings]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Panels: one at a time. Keep the last panel mounted while it slides out.
  const togglePanel = useCallback((name) => {
    setPanel((current) => (current === name ? null : name));
    setRenderedPanel(name);
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && panel && !settingsOpen && !confirm) setPanel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, settingsOpen, confirm]);

  useEffect(() => { if (panel === 'chat') setSeen(socket.messages.length); }, [panel, socket.messages.length]);
  const unread = socket.messages.slice(seen).filter((m) => m.senderId !== user.id).length;

  const handRaised = socket.hands.has(user.id);
  const toggleHand = async () => {
    try {
      if (handRaised) await socket.lowerHand();
      else await socket.raiseHand();
    } catch (error) { notify(error.message, 'error'); }
  };

  const elapsedMs = now - (liveClass.status === 'LIVE' && liveClass.startedAt
    ? Math.min(new Date(liveClass.startedAt).getTime(), joinedAt)
    : joinedAt);
  const recordingActive = recordings.some((r) => (
    ['STARTING', 'ACTIVE'].includes(r.status) || (r.status === 'STOPPED' && !r.endedAt)
  ));
  const recordingStopping = recordings.some((r) => r.status === 'STOPPED' && !r.endedAt);
  const activeRecording = recordings.find((r) => ['STARTING', 'ACTIVE'].includes(r.status));

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen?.();
    } catch { notify('Fullscreen is not available in this browser.', 'error'); }
  };

  const runConfirmed = async () => {
    setWorking(true);
    try {
      if (confirm.type === 'record') {
        await liveClassesAPI.startRecording(liveClass.id, true);
        notify('Recording started. Everyone has been notified.');
        await refreshRecordings();
      } else if (confirm.type === 'stop') {
        await liveClassesAPI.stopRecording(liveClass.id, activeRecording.id);
        notify('Recording is finishing. It will be available when processing completes.');
        await refreshRecordings();
      } else if (confirm.type === 'end') {
        await onEndClass();
      }
      setConfirm(null);
    } catch (error) {
      notify(errorMessage(error, 'That action failed.'), 'error');
      setConfirm(null);
    } finally {
      setWorking(false);
    }
  };

  const moreItems = [
    { key: 'people', icon: Users, label: 'Participants', mobileOnly: true, onClick: () => togglePanel('people') },
    { key: 'info', icon: Info, label: 'Meeting information', onClick: () => togglePanel('info') },
    { key: 'settings', icon: Settings, label: 'Audio and video settings', onClick: () => setSettingsOpen(true) },
    {
      key: 'fullscreen', icon: fullscreen ? Minimize : Maximize, label: fullscreen ? 'Exit full screen' : 'Full screen', onClick: toggleFullscreen,
      hidden: !document.documentElement.requestFullscreen,
    },
    {
      key: 'link', icon: Copy, label: 'Copy class link',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}/live-classes/${liveClass.id}/room`);
          notify('Class link copied.');
        } catch { notify('Could not copy the link.', 'error'); }
      },
    },
    {
      key: 'record', icon: recordingActive ? Square : Radio,
      label: recordingStopping ? 'Recording is finishing' : recordingActive ? 'Stop recording' : 'Record class',
      hidden: !isHost || recordingStopping, separator: true, danger: recordingActive,
      onClick: () => setConfirm({ type: recordingActive ? 'stop' : 'record' }),
    },
    {
      key: 'end', icon: PhoneOff, label: 'End class for everyone', hidden: !isHost, danger: true,
      onClick: () => setConfirm({ type: 'end' }),
    },
  ];

  const confirmCopy = {
    record: {
      title: 'Start recording this class?',
      body: 'Continue only after everyone has been told the session will be recorded and has agreed.',
      label: 'Start recording',
    },
    stop: { title: 'Stop recording?', body: 'The recording will be processed and made available after the class.', label: 'Stop recording', danger: true },
    end: { title: 'End class for everyone?', body: 'All participants will be disconnected and attendance will be closed.', label: 'End class', danger: true },
  };

  const reconnecting = connectionState === ConnectionState.Reconnecting
    || connectionState === ConnectionState.SignalReconnecting;
  const connecting = connectionState === ConnectionState.Connecting;

  return (
    <div className={`rt-room${panel ? ' has-panel' : ''}`} ref={rootRef}>
      <MeetingHeader
        title={liveClass.title}
        elapsedMs={elapsedMs}
        participantCount={participants.length}
        recording={recordingActive}
        onOpenPeople={() => togglePanel('people')}
      />

      <div className="rt-body">
        <main className="rt-main">
          <VideoStage hands={socket.hands} onStopSharing={() => localParticipant.setScreenShareEnabled(false).catch((e) => notify(friendlyMediaError(e, 'screen'), 'error'))} />
          <ReactionLayer floating={reactions.floating} />
          {(reconnecting || connecting) && (
            <div className="rt-banner" role="status">
              <Loader2 size={15} className="rt-spin" /> {connecting ? 'Connecting to the class…' : 'Connection interrupted. Reconnecting…'}
            </div>
          )}
        </main>

        <aside
          className={`rt-panel${panel ? ' is-open' : ''}`}
          aria-hidden={!panel}
          inert={panel ? undefined : ''}
        >
          <div className="rt-panel-inner">
            {renderedPanel === 'chat' && (
              <ChatPanel
                messages={socket.messages}
                userId={user.id}
                connected={socket.connected}
                onSend={socket.sendChat}
                onClose={() => setPanel(null)}
                onError={(text) => notify(text, 'error')}
              />
            )}
            {renderedPanel === 'people' && (
              <ParticipantsPanel
                hands={socket.hands}
                viewerIsHost={isHost}
                onClose={() => setPanel(null)}
                onLowerHand={(id) => socket.manageHand(id, false).catch((e) => notify(e.message, 'error'))}
                onSetSpeaking={(id, can) => socket.setSpeakingPermission(id, can)
                  .then(() => notify(can ? 'They can now speak and share.' : 'Speaking permission removed.'))
                  .catch((e) => notify(e.message, 'error'))}
              />
            )}
            {renderedPanel === 'info' && (
              <InfoPanel liveClass={liveClass} elapsedMs={elapsedMs} onClose={() => setPanel(null)} />
            )}
          </div>
        </aside>
        {panel && <button type="button" className="rt-scrim" aria-label="Close panel" onClick={() => setPanel(null)} />}
      </div>

      <MeetingToolbar
        panel={panel}
        onPanel={togglePanel}
        handRaised={handRaised}
        onToggleHand={toggleHand}
        onReaction={reactions.send}
        unread={unread}
        moreItems={moreItems}
        onLeave={onLeave}
        notify={notify}
      />

      <div className="rt-toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`rt-toast is-${t.tone}`}>{t.text}</div>)}
      </div>

      {settingsOpen && <DeviceSettings onClose={() => setSettingsOpen(false)} onError={(text) => notify(text, 'error')} />}
      {confirm && (
        <ConfirmDialog
          {...confirmCopy[confirm.type]}
          confirmLabel={confirmCopy[confirm.type].label}
          busy={working}
          onConfirm={runConfirmed}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function EndScreen({ icon: Icon, title, body, actions }) {
  return (
    <div className="rt-screen rt-screen--center">
      <div className="rt-endcard">
        <span className="rt-endicon"><Icon size={26} /></span>
        <h1>{title}</h1>
        <p>{body}</p>
        <div className="rt-modal-actions">{actions}</div>
      </div>
    </div>
  );
}

export default function RoomView({
  liveClass, user, credentials, canPublish, devices, isHost, onExit, onRejoin,
}) {
  const [phase, setPhase] = useState('live'); // live | ended | lost | duplicate
  const leaving = useRef(false);
  const joinedAt = useRef(Date.now()).current;

  const audio = useMemo(() => (canPublish && devices.audioEnabled
    ? (devices.audioInput ? { deviceId: devices.audioInput } : true) : false), [canPublish, devices]);
  const video = useMemo(() => (canPublish && devices.videoEnabled
    ? (devices.videoInput ? { deviceId: devices.videoInput } : true) : false), [canPublish, devices]);
  const options = useMemo(() => ({
    adaptiveStream: true,
    dynacast: true,
    audioOutput: devices.audioOutput ? { deviceId: devices.audioOutput } : undefined,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    videoCaptureDefaults: { resolution: VideoPresets.h1080.resolution },
    publishDefaults: { simulcast: true },
  }), [devices.audioOutput]);

  const handleDisconnected = useCallback((reason) => {
    if (leaving.current) return;
    if (reason === DisconnectReason.ROOM_DELETED) setPhase('ended');
    else if (reason === DisconnectReason.DUPLICATE_IDENTITY) setPhase('duplicate');
    else if (reason !== DisconnectReason.CLIENT_INITIATED) setPhase('lost');
  }, []);

  const leave = useCallback(async (notice) => {
    leaving.current = true;
    await liveClassesAPI.leave(liveClass.id).catch(() => {});
    onExit(notice);
  }, [liveClass.id, onExit]);

  const endClass = async () => {
    leaving.current = true;
    try {
      await liveClassesAPI.end(liveClass.id);
    } catch (error) {
      leaving.current = false;
      throw error;
    }
    onExit('Class ended. Attendance has been closed.');
  };

  if (phase === 'ended') {
    return (
      <EndScreen
        icon={PhoneOff}
        title="This class has ended"
        body="The host ended the session. Attendance for your time in class has been recorded."
        actions={<button type="button" className="rt-btn rt-btn--primary" onClick={() => leave()}>Back to live classes</button>}
      />
    );
  }
  if (phase === 'duplicate') {
    return (
      <EndScreen
        icon={MonitorX}
        title="You joined from another device"
        body="Only one connection per person is allowed in a class. This one was closed."
        actions={(
          <>
            <button type="button" className="rt-btn" onClick={() => leave()}>Back to live classes</button>
            <button type="button" className="rt-btn rt-btn--primary" onClick={onRejoin}>Use this device</button>
          </>
        )}
      />
    );
  }
  if (phase === 'lost') {
    return (
      <EndScreen
        icon={WifiOff}
        title="You lost connection"
        body="We could not reconnect you automatically. Check your internet, then rejoin."
        actions={(
          <>
            <button type="button" className="rt-btn" onClick={() => leave()}>Leave</button>
            <button type="button" className="rt-btn rt-btn--primary" onClick={onRejoin}><RefreshCw size={15} /> Rejoin</button>
          </>
        )}
      />
    );
  }

  return (
    <LiveKitRoom
      serverUrl={credentials.serverUrl}
      token={credentials.token}
      connect
      audio={audio}
      video={video}
      options={options}
      onDisconnected={handleDisconnected}
      onMediaDeviceFailure={(failure, kind) => console.warn('Media device failure', kind, failure)}
      className="rt-livekit"
    >
      <RoomContent
        liveClass={liveClass}
        user={user}
        isHost={isHost}
        joinedAt={joinedAt}
        onLeave={() => leave()}
        onEnded={() => { leaving.current = false; setPhase('ended'); }}
        onEndClass={endClass}
      />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}
