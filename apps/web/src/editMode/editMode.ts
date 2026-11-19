import { useSyncExternalStore } from 'react';

/**
 * Edit mode: moving, placing and changing objects works only while it is on. Every visit starts in
 * view mode, so a stray click, drag or touch cannot change anything.
 *
 * Kept in memory for the page's lifetime, not in the browser's storage: navigating inside the app
 * (viewer, catalogue, piece page) keeps it, a reload or a new visit starts in view mode again.
 */
let editing = false;
const listeners = new Set<() => void>();

export function setEditMode(on: boolean) {
  if (on === editing) return;
  editing = on;
  listeners.forEach((l) => l());
}

export const isEditMode = () => editing;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Whether edit mode is on, and a way to turn it on or off. */
export function useEditMode(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, isEditMode, () => false), setEditMode];
}
