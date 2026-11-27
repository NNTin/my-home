import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setEditMode } from './editMode/editMode';
import { resetLoadingForTests } from './loading/loading';

// jsdom has no Sakuga: the HUD's elements are their plain stand-ins (docs/design/hud.md §7.5). A test in the node
// environment (no DOM: `@vitest-environment node`) has no elements at all.
if (typeof customElements !== 'undefined') (await import('./hud/fallback')).installFallback();

// Every test starts in view mode, as every visit does. The loading screen's module outlives the test's page: its
// load is forgotten and its waits cancelled, or a timer of a load that ended fires once jsdom is gone (the main CI
// failure after #211: "document is not defined" from loading.ts).
afterEach(() => {
  cleanup();
  setEditMode(false);
  resetLoadingForTests();
});
