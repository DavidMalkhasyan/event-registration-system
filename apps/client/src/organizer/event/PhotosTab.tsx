import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Star, Trash2 } from 'lucide-react';
import { ApiError, api, errorMessage, uploadFile } from '../../shared/api';
import { type EventImage, precheck } from '../../shared/images';
import { Alert, Button, ConfirmDialog, buttonClass } from '../../shared/ui';
import type { EventItem, Notice, Session } from '../types';

// Event photographs (K-713, PD-92): one cover and up to eight gallery photos. Uploads go one at a time;
// a preview is shown while each is processed. The server checks and re-encodes every file, so what the
// organizer sees after the upload is what participants will see.

const GALLERY_MAX = 8;

const REASON: Record<string, string> = {
  unsupported_type: 'is not a JPEG, PNG or WebP image',
  too_small: 'is smaller than 200 × 200 pixels',
  too_many_pixels: 'has too many pixels (at most 40 megapixels)',
  animated: 'is animated; choose a still image',
  unreadable: 'could not be read as an image',
  empty: 'is empty',
};

function uploadError(file: File, err: unknown): string {
  if (err instanceof ApiError && err.code === 'image_rejected')
    return `${file.name} ${REASON[String(err.body.reason)] ?? 'was refused'}.`;
  if (err instanceof ApiError && err.code === 'image_too_large') return `${file.name} is larger than 10 MB.`;
  return `${file.name}: ${errorMessage(err)}`;
}

/** A data: URL preview (the page's CSP allows data: images, not blob:). */
function preview(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

function FilePicker({
  label,
  multiple = false,
  disabled,
  onFiles,
  variant = 'outline',
}: {
  label: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  variant?: 'primary' | 'outline' | 'ghost';
}) {
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = ''; // choosing the same file again still triggers a change
    if (files.length) onFiles(files);
  };
  return (
    <label className={buttonClass(variant, 'sm', `file-picker${disabled ? ' is-disabled' : ''}`)}>
      <input
        type="file"
        className="sr-only"
        accept="image/jpeg,image/png,image/webp"
        multiple={multiple}
        disabled={disabled}
        onChange={change}
      />
      <ImagePlus size={15} aria-hidden="true" />
      {label}
    </label>
  );
}

function AltText({
  image,
  busy,
  onSave,
}: {
  image: EventImage;
  busy: boolean;
  onSave: (alt: string | null) => void;
}) {
  const [draft, setDraft] = useState<string>();
  const value = draft ?? image.alt ?? '';
  const dirty = value.trim() !== (image.alt ?? '');
  return (
    <form
      className="alt-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value.trim() || null);
        setDraft(undefined);
      }}
    >
      <input
        className="input"
        maxLength={300}
        value={value}
        placeholder="Describe the photo for screen readers"
        aria-label={`Description of ${image.role === 'cover' ? 'the cover' : `photo ${image.position}`}`}
        onChange={(e) => setDraft(e.target.value)}
      />
      <Button type="submit" size="sm" variant="ghost" disabled={busy || !dirty}>
        Save
      </Button>
    </form>
  );
}

export function PhotosTab({
  session,
  event,
  onChanged,
}: {
  session: Session;
  event: EventItem;
  onChanged: () => void;
}) {
  const [images, setImages] = useState<EventImage[]>();
  const [pending, setPending] = useState<{ name: string; src: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [errors, setErrors] = useState<string[]>([]);
  const [removing, setRemoving] = useState<EventImage>();
  const editable = event.status === 'SCHEDULED';
  const base = `/api/events/${event.id}/images`;

  const load = useCallback(() => {
    api<{ images: EventImage[] }>(base)
      .then((r) => setImages(r.images))
      .catch((e) => setErrors([errorMessage(e)]));
  }, [base]);
  useEffect(load, [load]);

  const cover = images?.find((i) => i.role === 'cover');
  const gallery = images?.filter((i) => i.role === 'gallery') ?? [];

  const run = async (work: () => Promise<void>, success?: string) => {
    setBusy(true);
    setNotice(undefined);
    setErrors([]);
    try {
      await work();
      if (success) setNotice({ kind: 'success', text: success });
      onChanged();
    } catch (err) {
      setErrors([errorMessage(err)]);
      if (err instanceof ApiError && err.code === 'gallery_changed') load();
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: File[], role: 'cover' | 'gallery') => {
    const room = role === 'cover' ? 1 : GALLERY_MAX - gallery.length;
    const chosen = files.slice(0, room);
    const problems: string[] = [];
    if (files.length > room)
      problems.push(
        `Only ${room} more ${room === 1 ? 'photo fits' : 'photos fit'}; the rest were not uploaded.`,
      );
    const ok = chosen.filter((f) => {
      const p = precheck(f);
      if (p) problems.push(p);
      return !p;
    });
    setBusy(true);
    setNotice(undefined);
    setErrors([]);
    setPending(await Promise.all(ok.map(async (f) => ({ name: f.name, src: await preview(f) }))));
    let added = 0;
    for (const file of ok) {
      try {
        const image = await uploadFile<EventImage>(`${base}?role=${role}`, file, { csrf: session.csrfToken });
        added += 1;
        setImages((list) => [...(list ?? []), image]);
      } catch (err) {
        problems.push(uploadError(file, err));
      }
      setPending((p) => p.slice(1));
    }
    setBusy(false);
    setErrors(problems);
    if (added)
      setNotice({
        kind: 'success',
        text: `${added} ${added === 1 ? 'photo' : 'photos'} added. Participants see ${role === 'cover' ? 'the cover' : 'them'} on the event page.`,
      });
    if (added) onChanged();
  };

  const replace = async (image: EventImage, file: File) => {
    const p = precheck(file);
    if (p) return setErrors([p]);
    setBusy(true);
    setNotice(undefined);
    setErrors([]);
    try {
      const updated = await uploadFile<EventImage>(`${base}/${image.id}/file`, file, {
        method: 'PUT',
        csrf: session.csrfToken,
      });
      setImages((list) => list?.map((i) => (i.id === image.id ? updated : i)));
      setNotice({ kind: 'success', text: 'Photo replaced.' });
      onChanged();
    } catch (err) {
      setErrors([uploadError(file, err)]);
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, delta: number) => {
    const order = gallery.map((g) => g.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + delta, 0, moved!);
    void run(async () => {
      const r = await api<{ images: EventImage[] }>(`${base}/order`, {
        method: 'PUT',
        csrf: session.csrfToken,
        body: { imageIds: order },
      });
      setImages(r.images);
    }, 'Order saved.');
  };

  const makeCover = (image: EventImage) =>
    void run(async () => {
      const r = await api<{ images: EventImage[] }>(`${base}/${image.id}/cover`, {
        method: 'POST',
        csrf: session.csrfToken,
      });
      setImages(r.images);
    }, 'Cover changed.');

  const saveAlt = (image: EventImage, alt: string | null) =>
    void run(async () => {
      const updated = await api<EventImage>(`${base}/${image.id}`, {
        method: 'PATCH',
        csrf: session.csrfToken,
        body: { alt },
      });
      setImages((list) => list?.map((i) => (i.id === image.id ? updated : i)));
    }, 'Description saved.');

  const remove = (image: EventImage) =>
    void run(async () => {
      await api(`${base}/${image.id}`, { method: 'DELETE', csrf: session.csrfToken });
      setRemoving(undefined);
      load();
    }, 'Photo removed.');

  if (!images) return errors.length ? <Alert>{errors[0]}</Alert> : <p className="muted">Loading photos…</p>;

  const card = (image: EventImage, index: number) => (
    <li key={image.id} className="photo-card">
      <img src={image.thumbnailUrl} alt={image.alt ?? ''} width={image.width} height={image.height} />
      <div className="photo-card-body">
        <strong>{image.role === 'cover' ? 'Cover' : `Photo ${index + 1}`}</strong>
        {editable && <AltText image={image} busy={busy} onSave={(alt) => saveAlt(image, alt)} />}
        {editable && (
          <div className="photo-actions">
            {image.role === 'gallery' && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || index === 0}
                  aria-label={`Move photo ${index + 1} earlier`}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={15} aria-hidden="true" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || index === gallery.length - 1}
                  aria-label={`Move photo ${index + 1} later`}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={15} aria-hidden="true" />
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => makeCover(image)}>
                  <Star size={15} aria-hidden="true" /> Make cover
                </Button>
              </>
            )}
            <FilePicker
              label="Replace"
              variant="ghost"
              disabled={busy}
              onFiles={([file]) => void replace(image, file!)}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-label={`Remove ${image.role === 'cover' ? 'the cover' : `photo ${index + 1}`}`}
              onClick={() => setRemoving(image)}
            >
              <Trash2 size={15} aria-hidden="true" /> Remove
            </Button>
          </div>
        )}
      </div>
    </li>
  );

  return (
    <div className="photos-tab stack">
      <p className="tab-intro">
        A cover photo replaces the poster on the event page and in your event list; up to {GALLERY_MAX} more
        photos form the gallery. JPEG, PNG or WebP, at most 10 MB each. Photos are re-encoded on our server:
        camera and location data are removed.
      </p>
      {!editable && <Alert kind="info">This event is cancelled; its photos can no longer be changed.</Alert>}
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {errors.map((e) => (
        <Alert key={e}>{e}</Alert>
      ))}
      <section aria-labelledby="cover-heading" className="photo-section">
        <div className="section-heading">
          <h3 id="cover-heading">Cover</h3>
          {editable && !cover && (
            <FilePicker
              label="Add a cover"
              variant="primary"
              disabled={busy}
              onFiles={(f) => void upload(f, 'cover')}
            />
          )}
        </div>
        {cover ? (
          <ul className="photo-list">{card(cover, 0)}</ul>
        ) : (
          <p className="muted">No cover yet: the event page shows its poster.</p>
        )}
      </section>
      <section aria-labelledby="gallery-heading" className="photo-section">
        <div className="section-heading">
          <h3 id="gallery-heading">
            Gallery{' '}
            <span className="tab-count">
              {gallery.length} of {GALLERY_MAX}
            </span>
          </h3>
          {editable && gallery.length < GALLERY_MAX && (
            <FilePicker
              label="Add photos"
              multiple
              disabled={busy}
              onFiles={(f) => void upload(f, 'gallery')}
            />
          )}
        </div>
        {gallery.length === 0 && pending.length === 0 && <p className="muted">No gallery photos yet.</p>}
        <ul className="photo-list">
          {gallery.map((g, i) => card(g, i))}
          {pending.map((p, i) => (
            <li key={`${p.name}-${i}`} className="photo-card is-pending" aria-busy="true">
              {p.src && <img src={p.src} alt="" />}
              <div className="photo-card-body">
                <strong>{p.name}</strong>
                <span className="muted">{i === 0 ? 'Uploading and checking…' : 'Waiting…'}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <ConfirmDialog
        open={!!removing}
        title={removing?.role === 'cover' ? 'Remove the cover?' : 'Remove this photo?'}
        confirmLabel="Remove"
        cancelLabel="Keep it"
        destructive
        busy={busy}
        onConfirm={() => removing && remove(removing)}
        onClose={() => setRemoving(undefined)}
      >
        <p>
          It disappears from the event page at once. This cannot be undone; you can upload it again later.
        </p>
      </ConfirmDialog>
    </div>
  );
}
