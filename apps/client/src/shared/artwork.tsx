// Deterministic local artwork (PD-70, PD-79): events have no image field, so the event's public ID picks
// one of six original CSS posters. The organizer and the public page use the same key, so an event looks
// the same everywhere. Posters are pure CSS shapes and type: no image files, no external resources.

type Poster = {
  variant: 'orbit' | 'sunrise' | 'bauhaus' | 'night' | 'arches' | 'ribbon';
  text: [string, string];
  /** Dominant colour, used for the small event dots in the sidebar and overview. */
  swatch: string;
};

const POSTERS: Poster[] = [
  { variant: 'orbit', text: ['Together', 'is better.'], swatch: '#c9b8ea' },
  { variant: 'sunrise', text: ['good people.', 'great ideas.'], swatch: '#ef7959' },
  { variant: 'bauhaus', text: ['Make', 'something.'], swatch: '#a9c3a0' },
  { variant: 'night', text: ['See you', 'there.'], swatch: '#3a3540' },
  { variant: 'arches', text: ['Meet', 'the moment.'], swatch: '#f0a68a' },
  { variant: 'ribbon', text: ['Show', 'up.'], swatch: '#b9a6e3' },
];

export const SWATCHES = POSTERS.map((p) => p.swatch);

export function artworkIndex(key: string): number {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % POSTERS.length;
}

export function EventArtwork({ artKey, caption }: { artKey: string; caption?: string }) {
  const poster = POSTERS[artworkIndex(artKey)]!;
  return (
    <div className={`event-art poster poster-${poster.variant}`} aria-hidden="true">
      <span className="poster-shape s1" />
      <span className="poster-shape s2" />
      <span className="poster-shape s3" />
      <span className="poster-type">
        {poster.text[0]}
        <br />
        {poster.text[1]}
      </span>
      {caption && <span className="poster-foot">{caption}</span>}
    </div>
  );
}
