-- 0016_provider_events: delivery evidence from the email provider (K-402, PD-98), as designed in
-- DATABASE_DESIGN.md: an immutable log of verified webhook events, unique by the Svix message ID (a
-- redelivered event is stored once), and insert-only matches to outbox generations. The delivery facts
-- on outbox_generations (delivered_at, bounced_at, ...) are a cache recomputed from the matched events,
-- so the order in which events arrive does not matter. No recipient address, subject or link is kept.

CREATE TABLE app.provider_events (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  svix_id             text NOT NULL,
  event_type          text NOT NULL,
  provider_email_id   text,
  tag_outbox_id       uuid,
  tag_generation      smallint,
  provider_created_at timestamptz,
  received_at         timestamptz NOT NULL,
  bounce_kind         text,
  reason_masked       text,
  payload_masked      jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT provider_events_u25 UNIQUE (svix_id),
  CONSTRAINT provider_events_ck_type CHECK (char_length(event_type) BETWEEN 1 AND 64),
  CONSTRAINT provider_events_ck_payload CHECK (jsonb_typeof(payload_masked) = 'object')
);
CREATE INDEX provider_events_ix_email ON app.provider_events (provider_email_id);

CREATE TABLE app.provider_event_matches (
  provider_event_id uuid PRIMARY KEY REFERENCES app.provider_events (id),
  outbox_id         uuid NOT NULL,
  generation        smallint NOT NULL,
  method            text NOT NULL,
  matched_at        timestamptz NOT NULL,
  CONSTRAINT provider_event_matches_fk27 FOREIGN KEY (outbox_id, generation)
    REFERENCES app.outbox_generations (outbox_id, generation) ON DELETE CASCADE,
  CONSTRAINT provider_event_matches_ck_method CHECK (method IN ('tag', 'provider_id'))
);
CREATE INDEX provider_event_matches_ix_generation ON app.provider_event_matches (outbox_id, generation);
