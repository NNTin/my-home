import type { OpeningOverride } from '@my-home/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testPlacement } from '../test/fixtures';
import { lastBody, openPiece, rowOf } from '../test/piecePage';
import type { InspectorProps } from './Inspector';

let inspector: InspectorProps | undefined;
vi.mock('./Inspector', () => ({
  Inspector: (props: InspectorProps) => {
    inspector = props;
    return <div data-testid="inspector" />;
  },
}));
vi.mock('../catalog-page/renderThumbnail', () => ({
  renderThumbnail: () => Promise.reject(new Error('no WebGL in jsdom')),
  THUMBNAIL_SIZE: 256,
}));

const kitchen = 'souterrain-kitchen-window';
const override = (params: OpeningOverride['params'], version = 1): OpeningOverride => ({
  homeId: 'mock-home',
  useId: kitchen,
  typeId: 'window.casement',
  params,
  version,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** Opens a window's editor through its row's Edit button. */
async function edit(useId: string, name: string) {
  await screen.findByText(/uses? in this environment/);
  fireEvent.click(rowOf('mock-home', useId).getByRole('button', { name: `Edit ${name}` }));
  return within(screen.getByRole('region', { name: `Edit ${name}` }));
}

const dimension = (name: string) =>
  [...document.querySelectorAll('.piece-dimensions div')]
    .find((d) => d.querySelector('dt')?.textContent === name)
    ?.querySelector('dd')?.textContent;

describe('the per-use editor', () => {
  afterEach(() => {
    cleanup();
    inspector = undefined;
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('shows overridden values and type defaults, and previews the real hole', async () => {
    openPiece('/catalog/openings/window.casement', {
      overrides: [override({ frameColor: '#383e42' })],
    });
    const editor = await edit(kitchen, 'Kitchen · back window');
    expect(editor.getByRole('textbox', { name: 'Frame colour, hex' })).toHaveValue('#383e42');
    const rows = [...document.querySelectorAll('.use-editor .use-param-source')].map(
      (r) => r.textContent,
    );
    expect(rows).toEqual(['Overridden Reset to type default', 'Type default']);
    // The kitchen window is 150 cm wide, with a 90 cm sill (the preview hole is 120 cm).
    expect(dimension('Width')).toBe('150.0 cm');
    expect(dimension('Sill height')).toBe('90.0 cm');
    expect(inspector!.parts[0]!.color).toBe('#383e42');
    // Unsaved values show in the preview.
    fireEvent.click(editor.getByRole('button', { name: 'More sashes' }));
    expect(document.querySelector('.piece-showing')).toHaveTextContent('with unsaved changes');
    expect(dimension('Sash 2 width')).toBeDefined();
  });

  it('resets a key and saves the overrides with the version', async () => {
    const api = openPiece('/catalog/openings/window.casement', {
      overrides: [override({ frameColor: '#383e42', sashes: 2 })],
    });
    const editor = await edit(kitchen, 'Kitchen · back window');
    expect(editor.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(editor.getByRole('button', { name: 'Reset frame colour to type default' }));
    expect(editor.getByRole('textbox', { name: 'Frame colour, hex' })).toHaveValue('#f7f7f5');
    fireEvent.click(editor.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.overrides.get(`mock-home/${kitchen}`)!.version).toBe(2));
    expect(lastBody(api, 'PUT', /opening-overrides/)).toEqual({
      version: 1,
      params: { sashes: 2 },
    });
    await waitFor(() =>
      expect(rowOf('mock-home', kitchen).getByLabelText('Overrides')).toHaveTextContent(
        /^2 sashes$/,
      ),
    );
    expect(editor.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('creates the first override with version 0', async () => {
    const api = openPiece('/catalog/openings/window.casement');
    const editor = await edit('souterrain-bedroom-window', 'Bedroom · front window');
    fireEvent.change(editor.getByRole('textbox', { name: 'Frame colour, hex' }), {
      target: { value: '#123456' },
    });
    fireEvent.click(editor.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(lastBody(api, 'PUT', /opening-overrides/)).toEqual({
        version: 0,
        params: { frameColor: '#123456' },
      }),
    );
  });

  it('shows why a size does not fit (422) inline', async () => {
    openPiece('/catalog/openings/window.casement');
    const editor = await edit('souterrain-bathroom-window', 'Bathroom · front window');
    const more = editor.getByRole('button', { name: 'More sashes' });
    for (let i = 0; i < 3; i++) fireEvent.click(more);
    expect(editor.getByRole('status', { name: 'Does not fit' })).toHaveTextContent(
      /4 sashes need at least 100\.0 cm, the opening is 90\.0 cm/,
    );
    fireEvent.click(editor.getByRole('button', { name: 'Save' }));
    expect(await editor.findByRole('alert', { name: 'Not saved' })).toHaveTextContent(
      /4 sashes need at least 100\.0 cm/,
    );
  });

  it('says "changed elsewhere" on a 409, and reloads keeping the unsaved values', async () => {
    const api = openPiece('/catalog/openings/window.casement', {
      overrides: [override({ frameColor: '#383e42' })],
    });
    const editor = await edit(kitchen, 'Kitchen · back window');
    // Someone else saves meanwhile.
    api.overrides.set(`mock-home/${kitchen}`, override({ frameColor: '#000000' }, 2));
    fireEvent.click(editor.getByRole('button', { name: 'More sashes' }));
    fireEvent.click(editor.getByRole('button', { name: 'Save' }));
    const alert = await editor.findByRole('alert');
    expect(alert).toHaveTextContent('Changed elsewhere');
    fireEvent.click(editor.getByRole('button', { name: 'Reload (keeps your values)' }));
    expect(await editor.findByRole('status', { name: '' })).toHaveTextContent(
      'Saved now: frame colour #000000',
    );
    // The unsaved values are still in the form, and saving now uses the new version.
    expect(editor.getByRole('textbox', { name: 'Frame colour, hex' })).toHaveValue('#383e42');
    expect(editor.getByRole('status', { name: 'Sashes' })).toHaveTextContent('2');
    fireEvent.click(editor.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(lastBody(api, 'PUT', /opening-overrides/)).toEqual({
        version: 2,
        params: { frameColor: '#383e42', sashes: 2 },
      }),
    );
  });

  it('renames, removes and restores furniture', async () => {
    const api = openPiece('/catalog/furniture/furniture.bed', {
      placements: [testPlacement({ params: { width: 1.8 } })],
    });
    await screen.findByText('1 use in this environment');
    expect(dimension('Width')).toBe('160.0 cm');
    fireEvent.click(
      rowOf('mock-home', 'souterrain-bed-1').getByRole('button', { name: 'Edit Bedroom · Bed' }),
    );
    // Furniture is previewed at its own size.
    expect(dimension('Width')).toBe('180.0 cm');
    const editor = within(screen.getByRole('region', { name: 'Edit Bedroom · Bed' }));
    fireEvent.change(editor.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Guest bed' },
    });
    fireEvent.click(editor.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(api.placements.get('souterrain-bed-1')!.name).toBe('Guest bed'));
    expect(lastBody(api, 'PATCH', /placements/)).toEqual({ version: 1, name: 'Guest bed' });
    const renamed = within(await screen.findByRole('region', { name: 'Edit Guest bed' }));
    fireEvent.click(renamed.getByRole('button', { name: 'Remove (to the trash)' }));
    await waitFor(() => expect(api.placements.get('souterrain-bed-1')!.removedAt).not.toBeNull());
    expect(api.calls('DELETE', /placements\/souterrain-bed-1\?version=2$/)).toHaveLength(1);
    expect(await screen.findByText('0 uses in this environment')).toBeInTheDocument();
    fireEvent.click(screen.getByText('In the trash (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Guest bed' }));
    expect(await screen.findByText('1 use in this environment')).toBeInTheDocument();
    expect(api.calls('POST', /placements\/souterrain-bed-1\/restore$/)).toHaveLength(1);
  });
});
