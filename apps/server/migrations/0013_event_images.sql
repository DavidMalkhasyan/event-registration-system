-- 0013_event_images: event photographs (K-712, amendment A-4, PD-92). Metadata only: the image files
-- live in the media storage (a directory outside the repository, MEDIA_DIR), never in the database.
-- Every stored image was decoded and re-encoded by the server as WebP without metadata, under a random
-- name; `storage_key` is that name (32 hex characters, so it can never form a path). An event has at
-- most one cover (position 0) and eight gallery images (positions 1 to 8); positions are unique per
-- role, checked at commit so a reorder can swap them in one transaction.

CREATE TABLE app.event_images (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id              uuid NOT NULL REFERENCES app.events (id),
  role                  text NOT NULL,
  position              smallint NOT NULL,
  storage_key           text NOT NULL,
  width                 integer NOT NULL,
  height                integer NOT NULL,
  byte_size             integer NOT NULL,
  thumb_byte_size       integer NOT NULL,
  alt_text              text,
  created_at            timestamptz NOT NULL,
  created_by_account_id uuid NOT NULL REFERENCES app.accounts (id),
  CONSTRAINT event_images_u_key UNIQUE (storage_key),
  CONSTRAINT event_images_u_position UNIQUE (event_id, role, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT event_images_ck_role CHECK ((role = 'cover' AND position = 0) OR (role = 'gallery' AND position BETWEEN 1 AND 8)),
  CONSTRAINT event_images_ck_key CHECK (storage_key ~ '^[0-9a-f]{32}$'),
  CONSTRAINT event_images_ck_size CHECK (width BETWEEN 1 AND 2400 AND height BETWEEN 1 AND 2400
    AND byte_size BETWEEN 1 AND 10485760 AND thumb_byte_size BETWEEN 1 AND 10485760),
  CONSTRAINT event_images_ck_alt CHECK (alt_text IS NULL OR char_length(btrim(alt_text)) BETWEEN 1 AND 300)
);
CREATE INDEX event_images_ix_event ON app.event_images (event_id, role, position);
