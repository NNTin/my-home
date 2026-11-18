import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// The pages put their scroll position back themselves (routing `useRestoredScroll`).
if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
