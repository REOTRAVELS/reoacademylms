import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const socketUrl = () => {
  if (import.meta.env.DEV) return window.location.origin;
  const configured = import.meta.env.VITE_API_BASE_URL;
  const configuredOrigin = configured?.replace(/\/api\/?$/, '');
  return configuredOrigin || window.location.origin;
};

// Chat, raised hands and host actions ride on the existing Socket.IO protocol
// (classroom:join / classroom:interaction:create / ...). Nothing new on the server.
export default function useClassroomSocket({ liveClassId, userId, onNotice, onRecording, onEnded }) {
  const socketRef = useRef(null);
  const handlers = useRef({ onNotice, onRecording, onEnded });
  handlers.current = { onNotice, onRecording, onEnded };

  const [connected, setConnected] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    let active = true;
    const socket = io(socketUrl(), {
      path: import.meta.env.PROD ? '/api/socket-io/socket.io' : '/socket.io',
      transports: ['websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    const join = () => {
      socket.emit('classroom:join', { liveClassId }, (result) => {
        if (!active) return;
        if (!result?.success) {
          handlers.current.onNotice?.(result?.message || 'Could not connect to class chat.');
          return;
        }
        setItems(result.interactions || []);
        setConnected(true);
      });
    };
    const onInteraction = (item) => {
      if (item.type === 'HAND_LOWER') {
        setItems((current) => current.map((existing) => (
          existing.type === 'HAND_RAISE' && existing.senderId === item.senderId
            ? { ...existing, active: false }
            : existing
        )));
        return;
      }
      setItems((current) => (
        current.some((existing) => existing.id && existing.id === item.id)
          ? current.map((existing) => (existing.id === item.id ? item : existing))
          : [...current, item]
      ));
    };

    socket.on('connect', join);
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('classroom:interaction', onInteraction);
    socket.on('classroom:presenter-permission', (event) => {
      if (event.participantId !== userId) return;
      handlers.current.onNotice?.(event.canPublish
        ? 'The host gave you permission to speak and share.'
        : 'The host turned off your microphone and camera permission.');
    });
    socket.on('classroom:recording', (event) => handlers.current.onRecording?.(event));
    socket.on('classroom:ended', () => handlers.current.onEnded?.());

    return () => {
      active = false;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [liveClassId, userId]);

  const emit = useCallback((event, payload) => new Promise((resolve, reject) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      reject(new Error('Reconnecting to the classroom. Try again in a moment.'));
      return;
    }
    socket.emit(event, { liveClassId, ...payload }, (result) => {
      if (!result?.success) reject(new Error(result?.message || 'That did not go through.'));
      else resolve(result.data);
    });
  }), [liveClassId]);

  const interact = useCallback((type, payload = {}) => emit('classroom:interaction:create', {
    type,
    payload,
    parentId: null,
    clientEventId: crypto.randomUUID(),
  }), [emit]);

  const messages = useMemo(
    () => items.filter((item) => item.type === 'CHAT' && !item.payload?.reaction && item.payload?.text),
    [items],
  );

  const hands = useMemo(() => {
    const map = new Map();
    items.filter((item) => item.type === 'HAND_RAISE' && item.active)
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
      .forEach((item) => map.set(item.senderId, item));
    return map;
  }, [items]);

  return {
    connected,
    messages,
    hands,
    sendChat: (text) => interact('CHAT', { text }),
    raiseHand: () => interact('HAND_RAISE'),
    lowerHand: () => interact('HAND_LOWER'),
    manageHand: (participantId, active) => emit('classroom:hand:manage', { participantId, active }),
    setSpeakingPermission: (participantId, canPublish) => emit('classroom:presenter:set', { participantId, canPublish }),
  };
}
