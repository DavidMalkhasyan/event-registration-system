import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runDueTasks } from '../src/modules/jobs/tasks.js';
import {
  createEvent,
  createHarness,
  drain,
  localIn,
  mailFor,
  moveClockTo,
  organizerHeaders,
  registerConfirmed,
  resetData,
  signIn,
  type Harness,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const reminders = (email: string) => mailFor(h, email).filter((m) => m.subject.startsWith('Reminder:'));

describe('reminders: exactly one per participant 24 hours before (P0 #13, FR-NTF-1, AC-28)', () => {
  it('sends one reminder to each confirmed participant, even if the job runs again or in parallel', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 2, startsInHours: 72 });
    await registerConfirmed(h, event.publicId, 'a@example.test');
    await registerConfirmed(h, event.publicId, 'b@example.test');
    await registerConfirmed(h, event.publicId, 'waiting@example.test');
    await drain(h);
    expect(reminders('a@example.test')).toHaveLength(0); // not due yet

    moveClockTo(new Date(event.startsAt), -24 * 3_600_000 + 60_000); // just after Start − 24 h
    await Promise.all([runDueTasks(h.db, 'w1'), runDueTasks(h.db, 'w2')]);
    await drain(h);
    await drain(h);

    expect(reminders('a@example.test')).toHaveLength(1);
    expect(reminders('b@example.test')).toHaveLength(1);
    expect(reminders('waiting@example.test')).toHaveLength(0); // only confirmed participants
    const slots = await h.db.selectFrom('app.reminder_slots').select(['filled_by']).execute();
    expect(slots.map((s) => s.filled_by)).toEqual(['reminder', 'reminder']);
  });

  it('counts a ticket email sent within 24 hours of the start as the reminder (FR-NTF-2 a, AC-34)', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 2, startsInHours: 10 });
    await registerConfirmed(h, event.publicId, 'late@example.test');
    await drain(h);
    moveClockTo(new Date(event.startsAt), -9 * 3_600_000);
    await drain(h);
    expect(reminders('late@example.test')).toHaveLength(0);
    expect(mailFor(h, 'late@example.test').filter((m) => m.subject.startsWith('Your ticket'))).toHaveLength(1);
    const slots = await h.db.selectFrom('app.reminder_slots').select(['filled_by']).execute();
    expect(slots.map((x) => x.filled_by)).toEqual(['ticket']);
  });

  it('does not send a reminder after the event has started (FR-NTF-5)', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 2, startsInHours: 72 });
    await registerConfirmed(h, event.publicId, 'a@example.test');
    moveClockTo(new Date(event.startsAt), 60_000);
    await drain(h);
    expect(reminders('a@example.test')).toHaveLength(0);
  });
});

describe('rescheduling notifies every affected participant (P0 #14, FR-EVT-6)', () => {
  it('emails confirmed and waiting participants and schedules a reminder for the new version', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    await registerConfirmed(h, event.publicId, 'confirmed@example.test');
    await registerConfirmed(h, event.publicId, 'waiting@example.test');
    await drain(h);

    const response = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/reschedule`,
      headers: organizerHeaders(s),
      payload: { localStart: localIn(96), expectedScheduleVersion: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().scheduleVersion).toBe(2);
    expect(response.json().timeZone).toBe('UTC'); // the time zone is preserved (API-D5)
    await drain(h);

    for (const email of ['confirmed@example.test', 'waiting@example.test']) {
      const change = mailFor(h, email).filter((m) => m.subject.startsWith('Date changed'));
      expect(change).toHaveLength(1);
    }

    // A stale version is rejected (concurrent edits).
    const stale = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/reschedule`,
      headers: organizerHeaders(s),
      payload: { localStart: localIn(120), expectedScheduleVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);

    // Exactly one reminder for the new version, 24 hours before the new start.
    moveClockTo(new Date(response.json().startsAt), -23 * 3_600_000);
    await drain(h);
    expect(reminders('confirmed@example.test')).toHaveLength(1);
    expect(reminders('confirmed@example.test')[0]!.text).toContain(new Date(response.json().startsAt).toISOString().slice(11, 16));
  });
});
