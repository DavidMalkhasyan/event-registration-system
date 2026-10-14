import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { EventArtwork } from './artwork';
import { Button } from './ui';

// Event photographs (K-713, PD-92): the cover in place of the CSS poster, and the public gallery with a
// viewer. Images come only from our own origin (/media/images/…), so the pages' CSP is unchanged.

export interface EventImage {
  id: string;
  role: 'cover' | 'gallery';
  position: number;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  alt: string | null;
}

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** A quick check before uploading; the server checks the content itself. */
export function precheck(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return `${file.name}: choose a JPEG, PNG or WebP image.`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name}: images can be at most 10 MB.`;
  return null;
}

/** The event's cover photograph, or its CSS poster when it has none. */
export function EventCover({
  artKey,
  src,
  alt,
  caption,
}: {
  artKey: string;
  src?: string | null;
  alt?: string | null;
  caption?: string;
}) {
  if (!src) return <EventArtwork artKey={artKey} caption={caption} />;
  // A cover without alternative text is decorative: the title is right next to it.
  return <img className="event-art event-photo" src={src} alt={alt ?? ''} loading="lazy" decoding="async" />;
}

/** The public gallery: thumbnails that open a viewer (arrow keys, Escape, focus returns to the thumbnail). */
export function Gallery({ images, title }: { images: EventImage[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open !== null && !dialog.open) dialog.showModal();
    if (open === null && dialog.open) dialog.close();
  }, [open]);
  if (images.length === 0) return null;
  const close = () => {
    const index = open;
    setOpen(null);
    if (index !== null) triggers.current[index]?.focus();
  };
  const step = (delta: number) =>
    setOpen((i) => (i === null ? i : (i + delta + images.length) % images.length));
  const current = open === null ? null : images[open]!;
  return (
    <section className="gallery" aria-label="Photos">
      <h3>Photos</h3>
      <ul className="gallery-grid">
        {images.map((image, i) => (
          <li key={image.id}>
            <button
              type="button"
              ref={(el) => {
                triggers.current[i] = el;
              }}
              onClick={() => setOpen(i)}
              aria-label={`Open photo ${i + 1} of ${images.length}${image.alt ? `: ${image.alt}` : ''}`}
            >
              <img src={image.thumbnailUrl} alt="" loading="lazy" decoding="async" />
            </button>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialogRef}
        className="viewer"
        aria-label={`Photos of ${title}`}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') step(1);
          if (e.key === 'ArrowLeft') step(-1);
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) close(); // a click on the backdrop
        }}
      >
        {current && (
          <figure>
            <img src={current.url} alt={current.alt ?? `Photo ${open! + 1} of ${title}`} />
            <figcaption>
              <span>
                {open! + 1} of {images.length}
              </span>
              {current.alt && <span>{current.alt}</span>}
            </figcaption>
            <div className="viewer-controls">
              <Button variant="outline" size="icon" aria-label="Previous photo" onClick={() => step(-1)}>
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button variant="outline" size="icon" aria-label="Next photo" onClick={() => step(1)}>
                <ChevronRight aria-hidden="true" />
              </Button>
              <Button variant="outline" size="icon" aria-label="Close" onClick={close}>
                <X aria-hidden="true" />
              </Button>
            </div>
          </figure>
        )}
      </dialog>
    </section>
  );
}
