import { act } from '@testing-library/react';
import { setEditMode } from '../editMode/editMode';

/** Turns edit mode on, as the "Edit" button does. */
export const enterEditMode = () => act(() => setEditMode(true));

/** Turns edit mode off, as "Done" does. */
export const leaveEditMode = () => act(() => setEditMode(false));
