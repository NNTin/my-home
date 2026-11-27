import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setEditMode } from './editMode/editMode';
import { installFallback } from './hud/fallback';

// jsdom has no Sakuga: the HUD's elements are their plain stand-ins (docs/design/hud.md §7.5).
installFallback();

// Every test starts in view mode, as every visit does.
afterEach(() => {
  cleanup();
  setEditMode(false);
});
