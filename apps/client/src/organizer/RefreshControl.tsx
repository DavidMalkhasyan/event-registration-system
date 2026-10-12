import { RefreshCw } from 'lucide-react';
import { Button } from '../shared/ui';
import type { AutoRefresh } from './use-auto-refresh';

/**
 * The Refresh button of one organizer view (K-704): reloads only that view's data, in place. While it
 * runs, the content stays on screen; a failure is reported next to it and the last data stays shown.
 */
export function RefreshControl({ state, label = 'Refresh' }: { state: AutoRefresh; label?: string }) {
  const { refresh, refreshing, error, updatedAt } = state;
  return (
    <div className="refresh-control">
      <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} aria-label={label}>
        <RefreshCw aria-hidden="true" className={refreshing ? 'spin' : undefined} />
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </Button>
      {updatedAt && !error && (
        <span className="refresh-status">
          Updated{' '}
          {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      )}
      {/* Only a failure is announced; the time of each silent refresh is not. */}
      <span className="refresh-status refresh-error" role="status">
        {error ? `Couldn’t refresh: ${error} Showing the last loaded data.` : ''}
      </span>
    </div>
  );
}
