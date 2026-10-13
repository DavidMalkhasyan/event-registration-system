-- 0012_event_location: an event's venue (K-711, amendment A-5, PD-91). Optional: existing events stay
-- valid without one. Coordinates are stored only when the organizer enters them (never derived or
-- guessed); without them, pages show the address and a directions link but no map. location_version
-- counts changes, so a venue-change notice can tell whether it is still the latest (freshness).

ALTER TABLE app.events
  ADD COLUMN venue_name           text,
  ADD COLUMN street_address       text,
  ADD COLUMN city                 text,
  ADD COLUMN region               text,
  ADD COLUMN postal_code          text,
  ADD COLUMN country              text,
  ADD COLUMN arrival_instructions text,
  ADD COLUMN latitude             numeric(8, 6),
  ADD COLUMN longitude            numeric(9, 6),
  ADD COLUMN location_version     integer NOT NULL DEFAULT 0,
  -- A location has a venue name, street address, city and country, or nothing at all.
  ADD CONSTRAINT events_ck_location CHECK (
    (venue_name IS NULL AND street_address IS NULL AND city IS NULL AND country IS NULL
       AND region IS NULL AND postal_code IS NULL AND arrival_instructions IS NULL AND latitude IS NULL)
    OR (venue_name IS NOT NULL AND street_address IS NOT NULL AND city IS NOT NULL AND country IS NOT NULL)),
  ADD CONSTRAINT events_ck_location_text CHECK (
    (venue_name IS NULL OR char_length(btrim(venue_name)) BETWEEN 1 AND 200)
    AND (street_address IS NULL OR char_length(btrim(street_address)) BETWEEN 1 AND 300)
    AND (city IS NULL OR char_length(btrim(city)) BETWEEN 1 AND 120)
    AND (region IS NULL OR char_length(btrim(region)) BETWEEN 1 AND 120)
    AND (postal_code IS NULL OR char_length(btrim(postal_code)) BETWEEN 1 AND 20)
    AND (country IS NULL OR char_length(btrim(country)) BETWEEN 2 AND 120)
    AND (arrival_instructions IS NULL OR char_length(arrival_instructions) BETWEEN 1 AND 1000)),
  ADD CONSTRAINT events_ck_coordinates CHECK (
    (latitude IS NULL) = (longitude IS NULL)
    AND (latitude IS NULL OR latitude BETWEEN -90 AND 90)
    AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)),
  ADD CONSTRAINT events_ck_location_version CHECK (location_version >= 0);

-- Confirmed and waiting participants hear about a changed venue (class B: it carries their links).
ALTER TABLE app.outbox_messages DROP CONSTRAINT outbox_messages_ck48;
ALTER TABLE app.outbox_messages ADD CONSTRAINT outbox_messages_ck48 CHECK ((message_type, regen_class, lane, is_required_notice) IN (
  ('verification', 'A', 'bulk', false), ('existing_access', 'A', 'bulk', false), ('ticket_resend', 'A', 'bulk', false),
  ('management_link_replaced', 'A', 'bulk', false), ('staff_invitation', 'A', 'bulk', false),
  ('sign_in', 'A', 'priority', false), ('email_change_confirmation', 'A', 'priority', false),
  ('account_verification', 'A', 'priority', false), ('password_reset', 'A', 'priority', false),
  ('account_exists_notice', 'A', 'bulk', false), ('organization_decision', 'A', 'bulk', false),
  ('ticket_confirmation', 'B', 'bulk', false), ('promotion', 'B', 'bulk', false), ('event_change', 'B', 'bulk', false), ('venue_change', 'B', 'bulk', false),
  ('event_cancellation', 'B', 'bulk', false), ('registration_cancelled', 'B', 'bulk', true), ('waitlist_removed', 'B', 'bulk', true),
  ('organizer_cancellation', 'B', 'bulk', true),
  ('email_change_notice', 'B', 'bulk', false), ('waitlist_confirmation', 'C', 'bulk', false), ('reminder', 'C', 'bulk', false),
  ('waitlist_closed', 'C', 'bulk', false)));
