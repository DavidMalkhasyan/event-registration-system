// Must stay the first import (FR-LNK-10 b): it moves the link token from the address bar into memory
// before any other application module runs. Pages read it through linkToken().
import './bootstrap-token';
import { createRoot } from 'react-dom/client';
import { EventPage } from './EventPage';
import { InvitePage, SignInPage, TicketPage, VerifyPage } from './LinkPages';
import { ManagePage } from './ManagePage';
import { InvalidLinkPage } from './shell';

// The participant and link entry (ADR-013). Routing by path only; tokens never come from the router.

function App() {
  const path = window.location.pathname;
  const eventMatch = /^\/e\/([A-Za-z0-9_-]{22,64})$/.exec(path);
  if (eventMatch) return <EventPage publicId={eventMatch[1]!} />;
  if (path === '/verify') return <VerifyPage />;
  if (path === '/manage') return <ManagePage />;
  if (path === '/ticket') return <TicketPage />;
  if (path === '/sign-in') return <SignInPage />;
  if (path === '/invite') return <InvitePage />;
  return <InvalidLinkPage />;
}

// No StrictMode here: its doubled effects would resolve a sign-in link twice and set two different pre-session cookies.
createRoot(document.getElementById('root')!).render(<App />);
