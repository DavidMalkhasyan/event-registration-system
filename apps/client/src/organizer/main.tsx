import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';

// Organizer entry (ADR-013). The staff device page has its own entry since K-507 (PD-69).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
