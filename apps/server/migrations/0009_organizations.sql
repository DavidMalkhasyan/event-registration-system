-- 0009_organizations: events belong to organizations; organizer accounts are members with a role
-- (K-708, amendment A-3, PD-88). Backward compatible: every existing organizer account becomes the
-- owner of one active organization, and its events move to it. Accounts, events, public IDs,
-- registrations, tickets, staff invitations, audit and outbox history are untouched; no account
-- gains any platform role. events.owner_account_id stays, as the account that created the event
-- (history and D-17 idempotent creation); authorization uses the organization from now on.

CREATE TABLE app.organizations (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  name                     text NOT NULL,
  description              text,
  status                   text NOT NULL,
  created_at               timestamptz NOT NULL,
  updated_at               timestamptz NOT NULL,
  email_verified_at        timestamptz,
  submitted_at             timestamptz,
  decided_at               timestamptz,
  -- The account an organization was created for when this migration ran (keeps the backfill idempotent).
  migrated_from_account_id uuid REFERENCES app.accounts (id),
  CONSTRAINT organizations_u_migrated UNIQUE (migrated_from_account_id),
  CONSTRAINT organizations_ck_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT organizations_ck_description CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT organizations_ck_status CHECK (status IN ('pending_verification', 'pending_approval', 'active', 'rejected', 'suspended')),
  -- An active, rejected or suspended organization was verified and decided on.
  CONSTRAINT organizations_ck_decided CHECK (status NOT IN ('active', 'rejected', 'suspended') OR decided_at IS NOT NULL)
);

CREATE TABLE app.organization_memberships (
  organization_id uuid NOT NULL REFERENCES app.organizations (id),
  account_id      uuid NOT NULL REFERENCES app.accounts (id),
  role            text NOT NULL,
  created_at      timestamptz NOT NULL,
  CONSTRAINT organization_memberships_pk PRIMARY KEY (organization_id, account_id),
  CONSTRAINT organization_memberships_ck_role CHECK (role IN ('owner', 'admin', 'member'))
);
CREATE INDEX organization_memberships_ix_account ON app.organization_memberships (account_id);

ALTER TABLE app.events ADD COLUMN organization_id uuid REFERENCES app.organizations (id);

-- BEGIN BACKFILL (the test organizations.test.ts runs exactly this section on legacy rows)
INSERT INTO app.organizations
  (name, status, created_at, updated_at, email_verified_at, submitted_at, decided_at, migrated_from_account_id)
SELECT a.email, 'active', a.created_at, now(), a.created_at, a.created_at, now(), a.id
FROM app.accounts a
WHERE NOT EXISTS (SELECT 1 FROM app.organizations o WHERE o.migrated_from_account_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM app.organization_memberships m WHERE m.account_id = a.id);

INSERT INTO app.organization_memberships (organization_id, account_id, role, created_at)
SELECT o.id, o.migrated_from_account_id, 'owner', o.created_at
FROM app.organizations o
WHERE o.migrated_from_account_id IS NOT NULL
ON CONFLICT (organization_id, account_id) DO NOTHING;

UPDATE app.events e
   SET organization_id = o.id
  FROM app.organizations o
 WHERE o.migrated_from_account_id = e.owner_account_id
   AND e.organization_id IS NULL;
-- END BACKFILL

ALTER TABLE app.events ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX events_ix_organization ON app.events (organization_id);
