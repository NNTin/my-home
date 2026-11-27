import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setEditMode } from './editMode/editMode';

// jsdom has no Sakuga: the HUD's elements are their plain stand-ins (docs/design/hud.md §7.5). A test in the node
// environment (no DOM: `@vitest-environment node`) has no elements at all.
if (typeof customElements !== 'undefined') (await import('./hud/fallback')).installFallback();

// Every test starts in view mode, as every visit does.
afterEach(() => {
  cleanup();
  setEditMode(false);
});
