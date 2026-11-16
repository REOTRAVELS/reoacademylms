import { useMemo, useState } from 'react';
import { useTracks, useParticipants } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { ChevronLeft, ChevronRight, MonitorX } from 'lucide-react';
import ParticipantTile from './ParticipantTile.jsx';
import useElementSize from './useElementSize.js';
import {
  computeGrid, maxTilesPerPage, paginate, promoteSpeakers,
} from './gridLayout.js';
import { displayName, isHostParticipant } from './participantMeta.js';

const GAP = 8;

export default function VideoStage({ hands, onStopSharing }) {
  const [gridRef, gridSize] = useElementSize();
  const [pinnedId, setPinnedId] = useState(null);
  const [page, setPage] = useState(0);
  const participants = useParticipants();

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const screenTrack = tracks.find((t) => t.source === Track.Source.ScreenShare && t.publication);
  const cameraTracks = useMemo(() => {
    const cams = tracks.filter((t) => t.source === Track.Source.Camera);
    // Host first, then you, then everyone else in join order.
    const rank = (t) => (isHostParticipant(t.participant) ? 0 : t.participant.isLocal ? 1 : 2);
    const joinOrder = new Map(participants.map((p, i) => [p.identity, i]));
    return [...cams].sort((a, b) => rank(a) - rank(b)
      || (joinOrder.get(a.participant.identity) ?? 0) - (joinOrder.get(b.participant.identity) ?? 0));
  }, [tracks, participants]);

  const pinnedTrack = !screenTrack && pinnedId
    ? cameraTracks.find((t) => t.participant.identity === pinnedId)
    : null;
  const focus = screenTrack || pinnedTrack;

  const togglePin = (identity) => setPinnedId((current) => (current === identity ? null : identity));

  // ---- Focus layout: shared screen (or pinned person) large, everyone else in a strip.
  if (focus) {
    const stripTracks = cameraTracks.filter((t) => t !== focus);
    const presenter = screenTrack?.participant;
    return (
      <div className="rt-stage rt-stage--focus">
        <div className="rt-focus">
          <ParticipantTile
            trackRef={focus}
            variant="focus"
            handRaised={false}
            pinned={Boolean(pinnedTrack)}
            onTogglePin={pinnedTrack ? () => togglePin(pinnedTrack.participant.identity) : undefined}
          />
          {presenter?.isLocal && (
            <div className="rt-presenting" role="status">
              <span>You are presenting to everyone</span>
              <button type="button" onClick={onStopSharing}>
                <MonitorX size={15} /> Stop sharing
              </button>
            </div>
          )}
          {presenter && !presenter.isLocal && (
            <div className="rt-presenting is-viewer" role="status">
              <span>{displayName(presenter)} is presenting</span>
            </div>
          )}
        </div>
        <div className="rt-strip" role="list" aria-label="Participants">
          {stripTracks.map((t) => (
            <div role="listitem" key={t.participant.identity}>
              <ParticipantTile
                trackRef={t}
                variant="strip"
                handRaised={hands.has(t.participant.identity)}
                pinned={pinnedId === t.participant.identity}
                onTogglePin={screenTrack ? undefined : () => togglePin(t.participant.identity)}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- Grid layout.
  const perPage = maxTilesPerPage(gridSize.width, gridSize.height);
  const speakingIds = new Set(participants.filter((p) => p.isSpeaking).map((p) => p.identity));
  const items = cameraTracks.map((t) => ({
    id: t.participant.identity,
    isLocal: t.participant.isLocal,
    isHost: isHostParticipant(t.participant),
    track: t,
  }));
  const ordered = promoteSpeakers(items, speakingIds, perPage);
  const paged = paginate(ordered, page, perPage);
  const grid = computeGrid(paged.items.length, gridSize.width, gridSize.height, GAP);

  return (
    <div className="rt-stage">
      <div className="rt-grid" ref={gridRef} style={{ '--gap': `${GAP}px` }}>
        {gridSize.width > 0 && paged.items.map((item) => (
          <ParticipantTile
            key={item.id}
            trackRef={item.track}
            variant="grid"
            style={{ width: grid.tileW, height: grid.tileH }}
            handRaised={hands.has(item.id)}
            pinned={false}
            onTogglePin={items.length > 1 ? () => togglePin(item.id) : undefined}
          />
        ))}
      </div>
      {paged.pages > 1 && (
        <div className="rt-pager" role="navigation" aria-label="Participant pages">
          <button type="button" onClick={() => setPage(paged.page - 1)} disabled={paged.page === 0} aria-label="Previous page">
            <ChevronLeft size={16} />
          </button>
          <span>{paged.page + 1} / {paged.pages}</span>
          <button type="button" onClick={() => setPage(paged.page + 1)} disabled={paged.page >= paged.pages - 1} aria-label="Next page">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
