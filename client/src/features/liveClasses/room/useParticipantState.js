import { useEffect, useReducer } from 'react';
import { ParticipantEvent } from 'livekit-client';

const EVENTS = [
  ParticipantEvent.TrackMuted,
  ParticipantEvent.TrackUnmuted,
  ParticipantEvent.TrackPublished,
  ParticipantEvent.TrackUnpublished,
  ParticipantEvent.TrackSubscribed,
  ParticipantEvent.TrackUnsubscribed,
  ParticipantEvent.LocalTrackPublished,
  ParticipantEvent.LocalTrackUnpublished,
  ParticipantEvent.IsSpeakingChanged,
  ParticipantEvent.ParticipantNameChanged,
  ParticipantEvent.ParticipantMetadataChanged,
  ParticipantEvent.ParticipantPermissionsChanged,
  ParticipantEvent.ConnectionQualityChanged,
];

// Re-renders when anything the UI shows about a participant changes, then reads live values.
export default function useParticipantState(participant) {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!participant) return undefined;
    EVENTS.forEach((event) => participant.on(event, bump));
    return () => EVENTS.forEach((event) => participant.off(event, bump));
  }, [participant]);

  return {
    micOn: Boolean(participant?.isMicrophoneEnabled),
    camOn: Boolean(participant?.isCameraEnabled),
    sharing: Boolean(participant?.isScreenShareEnabled),
    speaking: Boolean(participant?.isSpeaking),
    canPublish: participant?.permissions?.canPublish ?? false,
  };
}
