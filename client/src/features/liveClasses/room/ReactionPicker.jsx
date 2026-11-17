export const REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉', '👎'];

export default function ReactionPicker({ onPick }) {
  return (
    <div className="rt-reactions" role="menu" aria-label="Send a reaction">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          role="menuitem"
          className="rt-reaction"
          onClick={() => onPick(emoji)}
          aria-label={`React with ${emoji}`}
        >
          <span className="rt-emoji rt-reaction-emoji" aria-hidden="true">{emoji}</span>
        </button>
      ))}
    </div>
  );
}