import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { liveClassesAPI } from '../../../services/api';
import { useAuth } from '../../../hooks/useAuth';
import PreJoinLobby from './PreJoinLobby.jsx';
import RoomView from './RoomView.jsx';
import { tokenCanPublish } from './participantMeta.js';
import { JOIN_WINDOW_MINS, joinState, opensAt, untilLabel } from '../liveClassWindow.js';
import './classroom.css';

const messageOf = (error, fallback) => error?.response?.data?.message || error?.message || fallback;

export default function ClassroomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [liveClass, setLiveClass] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [credentials, setCredentials] = useState(null);
  const [devices, setDevices] = useState(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const lastDevices = useRef(null);

  const isHost = ['SUPER_ADMIN', 'TRAINER'].includes(user?.role?.name);
  const exit = useCallback((notice) => navigate('/live-classes', { state: notice ? { notice } : undefined, replace: true }), [navigate]);

  // The class list only returns classes this person may access (enrolled cohort, trainer assignment).
  // Joining is what opens attendance, so no token is requested until the person presses Join.
  const requestToken = useCallback(async () => {
    const { data } = await liveClassesAPI.join(id);
    return data.data;
  }, [id]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await liveClassesAPI.list();
        const found = list.data.data.find((item) => item.id === id);
        if (!active) return;
        if (!found) { setLoadError('This class could not be found, or you are not assigned to it.'); return; }
        const state = joinState(found);
        if (state === 'over') {
          setLoadError(found.status === 'CANCELLED' ? 'This class was cancelled.' : 'This class has ended.');
          return;
        }
        if (state === 'soon') {
          setLoadError(`This class opens in ${untilLabel(opensAt(found))}. You can join ${JOIN_WINDOW_MINS} minutes before it starts.`);
          return;
        }
        setLiveClass(found);
      } catch (error) {
        if (active) setLoadError(messageOf(error, 'Could not open this class.'));
      }
    })();
    return () => { active = false; };
  }, [id]);

  const handleJoin = async (chosen) => {
    setJoining(true);
    setJoinError('');
    try {
      const fresh = await requestToken();
      lastDevices.current = chosen;
      setCredentials(fresh);
      setDevices(chosen);
    } catch (error) {
      setJoinError(messageOf(error, 'Could not join the class.'));
    } finally {
      setJoining(false);
    }
  };

  const handleRejoin = async () => {
    try {
      const fresh = await requestToken();
      setDevices(null);
      setCredentials(fresh);
      // Remount the room with the same devices on the next tick.
      setTimeout(() => setDevices(lastDevices.current), 0);
    } catch (error) {
      setJoinError(messageOf(error, 'Could not rejoin the class.'));
      setDevices(null);
    }
  };

  if (loadError) {
    return (
      <div className="rt-screen rt-screen--center">
        <div className="rt-endcard">
          <span className="rt-endicon"><ShieldAlert size={26} /></span>
          <h1>You can’t join this class</h1>
          <p>{loadError}</p>
          <div className="rt-modal-actions">
            <button type="button" className="rt-btn rt-btn--primary" onClick={() => exit()}>Back to live classes</button>
          </div>
        </div>
      </div>
    );
  }

  if (!liveClass) {
    return (
      <div className="rt-screen rt-screen--center" role="status">
        <Loader2 size={28} className="rt-spin" />
        <p className="rt-muted">Opening the classroom…</p>
      </div>
    );
  }

  if (!devices) {
    return (
      <PreJoinLobby
        liveClass={liveClass}
        user={user}
        canPublish={isHost}
        joining={joining}
        error={joinError}
        onJoin={handleJoin}
        onBack={() => exit()}
      />
    );
  }

  return (
    <RoomView
      liveClass={liveClass}
      user={user}
      credentials={credentials}
      canPublish={tokenCanPublish(credentials.token)}
      devices={devices}
      isHost={isHost}
      onExit={exit}
      onRejoin={handleRejoin}
    />
  );
}
