import { useId } from 'react';
import type { SectionRole, SectionShape } from '../catalog/types';
import { sectionBounds, type SectionLabel } from './section';

/** Legend names, in the order the legend lists them. */
const ROLE_NAMES: Partial<Record<SectionRole, string>> = {
  wall: 'Wall',
  frame: 'Frame',
  sash: 'Sash',
  glass: 'Glass',
  panel: 'Panel',
  sill: 'Sill',
  leaf: 'Leaf',
  post: 'Post',
};
const nameOf = (role: SectionRole) => ROLE_NAMES[role] ?? role[0]!.toUpperCase() + role.slice(1);

/** SVG units are millimetres; y points down in SVG, so heights are negated. */
const MM = 1000;

/**
 * The section of an opening as SVG: the cut rectangles by role (the wall hatched, glass see-through),
 * the floor, and the opening and sill heights beside the drawing. No WebGL: tested in jsdom.
 */
export function SectionView({
  shapes,
  labels,
  floor,
}: {
  shapes: SectionShape[];
  labels: SectionLabel[];
  /** The floor's height, drawn as a line (wall openings and gates). */
  floor?: number | undefined;
}) {
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (shapes.length === 0) return <p className="section-empty">Nothing to cut here.</p>;
  const { z, y } = sectionBounds(shapes);
  const height = (y[1] - y[0]) * MM;
  const pad = Math.max(height * 0.06, 40);
  // Room on the right for the height marks.
  const marks = height * 0.35;
  const view = [
    z[0] * MM - pad,
    -y[1] * MM - pad,
    (z[1] - z[0]) * MM + 2 * pad + marks,
    height + 2 * pad,
  ];
  const font = Math.max(height / 22, 24);
  const markX = z[1] * MM + pad * 0.6;
  const vertical = labels.filter((l) => l.name === 'Opening height' || l.name === 'Sill height');
  const roles = [...new Set(shapes.map((s) => s.role))].sort(
    (a, b) =>
      Object.keys(ROLE_NAMES).indexOf(a) - Object.keys(ROLE_NAMES).indexOf(b) || a.localeCompare(b),
  );
  // The heights from the top of the opening and from the floor (see sectionLabels).
  const opening = shapes.filter((s) => s.role !== 'wall');
  const openingTop = Math.max(...opening.map((s) => s.y[1]), y[0]);
  const marksAt = (label: SectionLabel): [number, number] =>
    label.name === 'Sill height'
      ? [floor ?? y[0], (floor ?? y[0]) + label.value]
      : [openingTop - label.value, openingTop];

  return (
    <figure className="section-view">
      <svg
        className="section"
        viewBox={view.join(' ')}
        role="img"
        aria-label={`Section: ${labels.map((l) => `${l.name} ${l.label}`).join(', ')}`}
      >
        <defs>
          <pattern id={hatch} width={60} height={60} patternUnits="userSpaceOnUse">
            <rect width={60} height={60} fill="#4a4740" />
            <path d="M0 60 L60 0" stroke="#8a8478" strokeWidth={8} />
          </pattern>
        </defs>
        {floor !== undefined && (
          <line
            className="section-floor"
            x1={view[0]}
            x2={view[0]! + view[2]!}
            y1={-floor * MM}
            y2={-floor * MM}
          />
        )}
        {shapes.map((s, i) => (
          <rect
            key={i}
            data-role={s.role}
            x={s.z[0] * MM}
            y={-s.y[1] * MM}
            width={(s.z[1] - s.z[0]) * MM}
            height={(s.y[1] - s.y[0]) * MM}
            fill={s.role === 'wall' ? `url(#${hatch})` : s.color}
            fillOpacity={s.role === 'glass' ? 0.7 : 1}
          />
        ))}
        {vertical.map((label) => {
          const [from, to] = marksAt(label);
          const [y1, y2] = [-to * MM, -from * MM];
          const tick = pad * 0.3;
          return (
            <g key={label.name} className="section-mark">
              <line x1={markX} x2={markX} y1={y1} y2={y2} />
              <line x1={markX - tick} x2={markX + tick} y1={y1} y2={y1} />
              <line x1={markX - tick} x2={markX + tick} y1={y2} y2={y2} />
              <text
                x={markX + tick * 1.5}
                y={(y1 + y2) / 2}
                fontSize={font}
                dominantBaseline="middle"
              >
                {label.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        <ul className="section-legend" aria-label="Legend">
          {roles.map((role) => {
            const sample = shapes.find((s) => s.role === role)!;
            return (
              <li key={role}>
                <svg viewBox="0 0 60 60" aria-hidden="true" className="section-swatch">
                  <rect
                    width={60}
                    height={60}
                    fill={role === 'wall' ? `url(#${hatch})` : sample.color}
                    fillOpacity={role === 'glass' ? 0.7 : 1}
                  />
                </svg>
                {nameOf(role)}
              </li>
            );
          })}
        </ul>
        <dl className="section-labels">
          {labels.map((l) => (
            <div key={l.name}>
              <dt>{l.name}</dt>
              <dd>{l.label}</dd>
            </div>
          ))}
        </dl>
        <p className="section-note">
          Simplified design: the section shows what the design draws today (frame and glass or
          panel). Sill and sash profiles come with later design changes.
        </p>
      </figcaption>
    </figure>
  );
}
