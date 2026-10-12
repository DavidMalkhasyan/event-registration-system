import communityTable from '../../assets/art/community-table.jpg';
import creativeGathering from '../../assets/art/creative-gathering.jpg';
import designSummit from '../../assets/art/design-summit.jpg';

// Deterministic local artwork (PD-70): events have no image field, so the event ID picks one of the
// v0 photographs (bundled, compressed) or a CSS poster. Same event, same artwork, on every device.

type Art =
  | { kind: 'photo'; src: string; position: string }
  | { kind: 'poster'; tone: 'lavender' | 'peach' | 'sage'; text: [string, string] };

const ARTWORK: Art[] = [
  { kind: 'photo', src: creativeGathering, position: '54% 50%' },
  { kind: 'poster', tone: 'lavender', text: ['Together', 'is better.'] },
  { kind: 'photo', src: communityTable, position: '50% 45%' },
  { kind: 'poster', tone: 'peach', text: ['good people.', 'great ideas.'] },
  { kind: 'photo', src: designSummit, position: '70% 50%' },
  { kind: 'poster', tone: 'sage', text: ['Make', 'something.'] },
];

export const SWATCHES = ['#c9b8ea', '#b9a6e3', '#f2b29b', '#f0a68a', '#c6d6bd', '#a9c3a0'];

export function artworkIndex(eventId: string): number {
  let hash = 0;
  for (const ch of eventId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % ARTWORK.length;
}

export function EventArtwork({ eventId, caption }: { eventId: string; caption?: string }) {
  const art = ARTWORK[artworkIndex(eventId)]!;
  if (art.kind === 'photo')
    return (
      <div className="event-art" aria-hidden="true">
        <img src={art.src} alt="" style={{ objectPosition: art.position }} loading="lazy" />
      </div>
    );
  return (
    <div className={`event-art poster poster-${art.tone}`} aria-hidden="true">
      <span className="poster-orbit" />
      <span className="poster-type">
        {art.text[0]}
        <br />
        {art.text[1]}
      </span>
      {caption && <span className="poster-foot">{caption}</span>}
    </div>
  );
}
