const base = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets';

export const REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉', '👎'];

export const REACTION_IMAGES = {
  '👍': `${base}/Thumbs%20up/Default/3D/thumbs_up_3d_default.png`,
  '❤️': `${base}/Red%20heart/3D/red_heart_3d.png`,
  '😂': `${base}/Face%20with%20tears%20of%20joy/3D/face_with_tears_of_joy_3d.png`,
  '😮': `${base}/Face%20with%20open%20mouth/3D/face_with_open_mouth_3d.png`,
  '👏': `${base}/Clapping%20hands/Default/3D/clapping_hands_3d_default.png`,
  '🎉': `${base}/Party%20popper/3D/party_popper_3d.png`,
  '👎': `${base}/Thumbs%20down/Default/3D/thumbs_down_3d_default.png`,
};

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
          <img src={REACTION_IMAGES[emoji]} alt={emoji} width={28} height={28} draggable={false} />
        </button>
      ))}
    </div>
  );
}