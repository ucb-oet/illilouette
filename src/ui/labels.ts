// The label column's layout, shared by the renderer and the controller.
import type { Info } from '../model/source';

/** Space at the column's edges, and between its columns. */
export const EDGE = 10;
export const GAP = 14;
const TYPE_GAP = 12;
/** Characters a type name is indented by for each shown ancestor. */
const INDENT = 2;
/** A character's width in the monospace font, in ems, for estimating widths before anything is drawn. */
export const CHAR_EM = 0.6;

export function labelFontSize(rowH: number): number {
  return rowH >= 18 ? 12 : 11;
}

/** How deep a row is among the rows shown: how many of its ancestors' types are shown. */
export function depth(ancestors: number[], hidden: ReadonlySet<number>): number {
  return ancestors.filter((a) => !hidden.has(a)).length;
}

export function labelColumns(info: Info, hidden: ReadonlySet<number>, charW: number) {
  const shown = info.types.filter((_, i) => !hidden.has(i));
  const showType = shown.length > 1;
  const deepest = Math.max(0, ...shown.map((t) => depth(t.ancestorTypes, hidden)));
  const typeW = showType ? (Math.max(...info.types.map((t) => t.name.length)) + deepest * INDENT) * charW + TYPE_GAP : 0;
  const idW = Math.max(...info.types.map((t) => t.idWidth)) * charW;
  const labelsW = Math.max(0, ...shown.map((t) => t.labelWidths.reduce((sum, w) => sum + w * charW + GAP, 0)));
  return {
    showType,
    typeW,
    idW,
    indent: (ancestors: number[]) => depth(ancestors, hidden) * INDENT * charW,
    fullW: EDGE + typeW + idW + GAP + labelsW - GAP + EDGE,
  };
}
