import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setEditMode } from './editMode/editMode';

// Every test starts in view mode, as every visit does.
afterEach(() => {
  cleanup();
  setEditMode(false);
});
