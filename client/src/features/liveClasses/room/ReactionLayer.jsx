import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { REACTIONS } from './ReactionPicker.jsx';
import { displayName } from './participantMeta.js';

const TOPIC = 'reo-reaction';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Reactions are ephemeral LiveKit data messages: never stored, never added to chat.
export function useReactions() {
  const room = useRoomContext();
  const [floating, setFloating] = useState([]);
  const lastSent = useRef(0);

  const show = useCallback((emoji, name) => {
    const id = crypto.randomUUID();
    setFloating((current) => [...current.slice(-24), {
      id, emoji, name, left: 8 + Math.random() * 78, drift: Math.round((Math.random() - 0.5) * 60),
    }]);
    window.setTimeout(() => setFloating((current) => current.filter((r) => r.id !== id)), 3200);
  }, []);

  useEffect(() => {
    const onData = (payload, participant, _kind, topic) => {
      if (topic !== TOPIC || !participant) return;
      try {
        const message = JSON.parse(decoder.decode(payload));
        if (REACTIONS.includes(message?.emoji)) show(message.emoji, displayName(participant));
      } catch { /* ignore malformed packets */ }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => room.off(RoomEvent.DataReceived, onData);
  }, [room, show]);

  const send = useCallback(async (emoji) => {
    if (!REACTIONS.includes(emoji)) return;
    const now = Date.now();
    if (now - lastSent.current < 350) return;
    lastSent.current = now;
    show(emoji, 'You');
    try {
      await room.localParticipant.publishData(
        encoder.encode(JSON.stringify({ emoji })),
        { reliable: false, topic: TOPIC },
      );
    } catch { /* the local animation already played; a dropped reaction is harmless */ }
  }, [room, show]);

  return { floating, send };
}

export default function ReactionLayer({ floating }) {
  return (
    <div className="rt-float-layer" aria-hidden="true">
      {floating.map((reaction) => (
        <div
          key={reaction.id}
          className="rt-float"
          style={{ left: `${reaction.left}%`, '--drift': `${reaction.drift}px` }}
        >
          <span className="rt-float-emoji">{reaction.emoji}</span>
          <span className="rt-float-name">{reaction.name}</span>
        </div>
      ))}
    </div>
  );
}
