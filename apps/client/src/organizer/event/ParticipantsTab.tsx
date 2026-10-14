import { useState } from 'react';
import { Check, Search, Users, X } from 'lucide-react';
import { Alert, Empty, Status } from '../../shared/ui';
import type { EventItem, Notice, Participant, Session } from '../types';
import { CancelRegistration, RemoveFromWaitlist, UndoCheckIn } from './ParticipantActions';

export const STATE: Record<string, { label: string; tone: string }> = {
  CONFIRMED: { label: 'Confirmed', tone: 'confirmed' },
  WAITLISTED: { label: 'Waiting list', tone: 'waiting' },
  PENDING_VERIFICATION: { label: 'Pending confirmation', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'cancelled' },
  EXPIRED: { label: 'Expired', tone: 'expired' },
};

/** Why an ended registration ended; cancelled people stay in the list (K-703). */
const END_REASON: Record<string, string> = {
  participant_cancelled: 'by the participant',
  cancelled_by_organizer: 'by you',
  removed_by_organizer: 'removed from the waiting list',
  event_cancelled: 'event cancelled',
  cutoff: 'not confirmed before registration closed',
};

const ISSUE: Record<string, string> = {
  failed: 'failed',
  delivery_outcome_unknown: 'delivery outcome unknown',
  bounced: 'bounced (not delivered)',
  complained: 'marked as spam by the recipient',
};

/** One event's participants (FR-DSH-4), or only its waiting list in queue order (FR-WL). */
export function ParticipantsTab({
  session,
  event,
  participants,
  waitingOnly = false,
  notice,
  onNotice,
}: {
  session: Session;
  event: EventItem;
  participants: Participant[];
  waitingOnly?: boolean;
  notice?: Notice;
  onNotice: (notice: Notice) => void;
}) {
  const [search, setSearch] = useState('');
  const [state, setState] = useState('ALL');
  const scheduled = event.status === 'SCHEDULED';
  const beforeStart = scheduled && event.phase !== 'started';
  const waiting = participants.filter((p) => p.state === 'WAITLISTED').length;
  const base = waitingOnly
    ? participants
        .filter((p) => p.state === 'WAITLISTED')
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    : participants;
  const q = search.trim().toLowerCase();
  const rows = base.filter(
    (p) => (!q || p.email.toLowerCase().includes(q)) && (state === 'ALL' || p.state === state),
  );

  return (
    <div>
      <div className="toolbar">
        <div className="search-box">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={waitingOnly ? 'Search the waiting list' : 'Search participants'}
            placeholder="Search by email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button aria-label="Clear search" onClick={() => setSearch('')}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        {!waitingOnly && (
          <select
            className="select select-auto"
            aria-label="Registration status"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="ALL">All participants</option>
            {Object.entries(STATE).map(([key, s]) => (
              <option key={key} value={key}>
                {s.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {waitingOnly && (
        <p className="muted tab-intro">
          Seats that become free before registration closes go to the first person in line. Removing someone
          here never promotes anyone.
        </p>
      )}
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {rows.length === 0 ? (
        <Empty
          icon={<Users size={28} aria-hidden="true" />}
          title={
            base.length === 0 ? (waitingOnly ? 'Nobody is waiting.' : 'No participants yet.') : 'No match.'
          }
          text={
            base.length === 0
              ? waitingOnly
                ? 'When the event is full, new registrations join the waiting list here.'
                : 'Share the public registration link to welcome your first participants.'
              : 'Try another search or status.'
          }
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table stack-table">
            <thead>
              <tr>
                <th>Participant</th>
                <th>Registration</th>
                <th>Check-in</th>
                <th>Email issues</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const s = STATE[p.state] ?? { label: p.state, tone: 'neutral' };
                return (
                  <tr key={p.registrationId}>
                    <td data-label="Participant">
                      <div className="participant-cell">
                        <span className="person-avatar" aria-hidden="true">
                          {p.email.slice(0, 2).toUpperCase()}
                        </span>
                        <span>{p.email}</span>
                      </div>
                    </td>
                    <td data-label="Registration">
                      <Status tone={s.tone}>{s.label}</Status>
                      {p.state === 'WAITLISTED' && <small>Position #{p.position}</small>}
                      {p.endReason && END_REASON[p.endReason] && <small>{END_REASON[p.endReason]}</small>}
                    </td>
                    <td data-label="Check-in">
                      {p.checkedInAt ? (
                        <span className="checked-label">
                          <Check size={14} aria-hidden="true" />
                          Checked in {new Date(p.checkedInAt).toLocaleTimeString()}
                        </span>
                      ) : (
                        <span className="muted">Not checked in</span>
                      )}
                    </td>
                    <td data-label="Email issues">
                      {p.emailIssues.length === 0 ? (
                        <span className="muted">None</span>
                      ) : (
                        p.emailIssues.map((i) => `${i.messageType}: ${ISSUE[i.label] ?? i.label}`).join(', ')
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        {beforeStart && (
                          <CancelRegistration
                            session={session}
                            eventId={event.id}
                            participant={p}
                            waiting={waiting}
                            promotionOpen={event.phase === 'registration_open'}
                            onDone={onNotice}
                          />
                        )}
                        {scheduled && (
                          <RemoveFromWaitlist
                            session={session}
                            eventId={event.id}
                            participant={p}
                            onDone={onNotice}
                          />
                        )}
                        <UndoCheckIn session={session} eventId={event.id} participant={p} onDone={onNotice} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted table-count">
        {rows.length} of {base.length} {waitingOnly ? 'waiting' : 'participants'}
      </p>
    </div>
  );
}
