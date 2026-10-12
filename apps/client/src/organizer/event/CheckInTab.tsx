import { CircleCheck } from 'lucide-react';
import { CheckInPanel } from '../../checkin/CheckInPanel';
import { Alert, SectionHeading, Status } from '../../shared/ui';
import { phaseOf } from '../events/event-status';
import type { EventItem, Notice, Participant, Session } from '../types';
import { UndoCheckIn } from './ParticipantActions';

/** The owner's entrance screen for one event, with recent arrivals and undo (FR-CHK-8). */
export function CheckInTab({
  session,
  event,
  participants,
  notice,
  onNotice,
}: {
  session: Session;
  event: EventItem;
  participants: Participant[];
  notice?: Notice;
  onNotice: (notice: Notice) => void;
}) {
  const phase = phaseOf(event);
  // Derived from this event's participant list: real check-ins only, newest first.
  const arrivals = participants
    .filter((p) => p.checkInId && p.checkedInAt)
    .sort((a, b) => b.checkedInAt!.localeCompare(a.checkedInAt!));
  return (
    <CheckInPanel
      csrfToken={session.csrfToken}
      eventId={event.id}
      mode="owner"
      event={{
        title: event.title,
        timeZone: event.timeZone,
        opensAt: event.checkInOpensAt,
        closesAt: event.checkInClosesAt,
        status: <Status tone={phase.tone}>{phase.label}</Status>,
      }}
      aside={
        <section className="panel panel-body" aria-labelledby="arrivals-heading">
          <SectionHeading
            title={<span id="arrivals-heading">Recent arrivals</span>}
            description="Every hello, in one place."
          />
          {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
          {arrivals.length === 0 ? (
            <p className="muted">Checked-in participants will appear here.</p>
          ) : (
            arrivals.slice(0, 12).map((p) => (
              <div className="arrival-row" key={p.registrationId}>
                <span className="activity-icon" aria-hidden="true">
                  <CircleCheck size={16} />
                </span>
                <div>
                  <strong>{p.email}</strong>
                  <small>Checked in {new Date(p.checkedInAt!).toLocaleTimeString()}</small>
                </div>
                <UndoCheckIn session={session} eventId={event.id} participant={p} onDone={onNotice} />
              </div>
            ))
          )}
        </section>
      }
    />
  );
}
