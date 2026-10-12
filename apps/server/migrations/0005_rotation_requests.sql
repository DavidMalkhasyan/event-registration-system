-- 0005_rotation_requests: committed link rotations (FR-ROT-3, FR-ROT-9, FR-ROT-11, TX-P03).
-- Source: DATABASE_DESIGN.md §5 (rotation_requests) and CONSTRAINTS_AND_INDEXES (U-20, FK-16 to FK-18).
-- Only committed rotations have a row, which implements FR-ROT-11 (d) directly.

CREATE TABLE app.rotation_requests (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),                  -- PK-14
  registration_id       uuid NOT NULL,
  event_id              uuid NOT NULL,
  request_id            uuid NOT NULL,
  link_type             text NOT NULL,
  authorizing_token_id  uuid NOT NULL REFERENCES app.access_tokens (id),     -- FK-18 (NO ACTION)
  new_token_id          uuid NOT NULL REFERENCES app.access_tokens (id),     -- FK-17 (NO ACTION)
  decided_at            timestamptz NOT NULL,
  outbox_message_id     uuid,                                               -- soft reference
  CONSTRAINT rotation_requests_u20 UNIQUE (registration_id, request_id),    -- request IDs are single-use forever
  CONSTRAINT rotation_requests_fk16 FOREIGN KEY (registration_id, event_id)
    REFERENCES app.registrations (id, event_id) ON DELETE CASCADE,
  CONSTRAINT rotation_requests_ck72 CHECK (link_type IN ('management', 'share')
    AND (outbox_message_id IS NULL OR link_type = 'management'))
);
CREATE INDEX rotation_requests_ix18 ON app.rotation_requests (new_token_id);
CREATE INDEX rotation_requests_ix19 ON app.rotation_requests (authorizing_token_id);
