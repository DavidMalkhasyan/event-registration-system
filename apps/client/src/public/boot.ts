// Public entry (FR-LNK-10 b, ADR-011, PD-71). The only static import is the bootstrap, which has no
// imports of its own: it reads the fragment, keeps the token in module memory and strips it from the
// address bar. The application (React, shared UI, API client) is loaded only afterwards, through a
// dynamic import, so none of its modules can execute before the capture, whatever the bundler's
// chunk order.
import './bootstrap-token';

void import('./main');
