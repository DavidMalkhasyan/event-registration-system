import { useEffect, useState } from 'react';

/**
 * The event's checked-in count over SSE (FR-DSH-3). EventSource reconnects automatically and every
 * connection starts with the authoritative count; the value shown is always the server's.
 */
export function useLiveCount(eventId: string): { count: number | null; connected: boolean } {
  const [count, setCount] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const source = new EventSource(`/api/events/${eventId}/live`);
    source.addEventListener('count', (e) => {
      setCount(JSON.parse((e as MessageEvent<string>).data).checkedIn);
      setConnected(true);
    });
    source.addEventListener('access_ended', () => {
      source.close();
      setConnected(false);
    });
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [eventId]);
  return { count, connected };
}
