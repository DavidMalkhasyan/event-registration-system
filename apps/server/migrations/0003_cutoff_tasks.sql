-- 0003_cutoff_tasks: cutoff processing for events created before the cutoff task existed (F8, TX-J03).
-- New events and reschedules insert their own task. This backfills one task for the current
-- schedule version of every SCHEDULED event; U-26 makes it a no-op where a task already exists.
INSERT INTO app.scheduled_tasks (kind, event_id, schedule_version, due_at, params, created_at)
SELECT 'cutoff_processing', e.id, e.schedule_version, e.starts_at - interval '2 hours', '{}'::jsonb, clock_timestamp()
FROM app.events e
WHERE e.status = 'SCHEDULED'
ON CONFLICT (kind, event_id, schedule_version) DO NOTHING;
