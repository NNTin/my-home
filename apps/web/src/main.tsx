import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installFallback } from './hud/fallback';
import { applyEffectsSetting } from './hud/effects';
import { provideToggleFrames } from './hud/toggle';
import './styles.css';

// The pages put their scroll position back themselves (routing `useRestoredScroll`).
if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';

// sakuga-hud (a deferred script, run before this module) defined the HUD's elements; if it did not load, the HUD
// works plain (docs/design/hud.md §7.5).
installFallback();
// The painted toggle's frames come lazily, once the loading screen has gone (§9.3).
provideToggleFrames();
// Effects off on this device: calm from the start (§10.4).
applyEffectsSetting();

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
