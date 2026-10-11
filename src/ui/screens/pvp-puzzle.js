'use strict';
/**
 * Puzzle geometry of the card-piece hunts (Pieces tab, piece popup): the grid, complementary knob / notch edges and
 * clip-path polygons for the piece counts the client has no sprites for, and the original puzzle overlay sprites
 * (piece{N}_{i}.png / ...b.png positions). Pure and DOM-free (tests/pvp-ui.test.js).
 */

/**
 * Puzzle grid for a number of pieces: one column for tiny hunts, two columns otherwise.
 * @param {number} total
 * @returns {{cols: number, rows: number}}
 */
export function pieceGrid(total) {
  const n = Math.max(1, total | 0);
  const cols = n < 4 ? 1 : 2;
  return { cols, rows: Math.ceil(n / cols) };
}

/**
 * Edge shapes of a piece: 1 = knob out, -1 = notch in, 0 = flat (board edge). Neighbours are always
 * complementary: the knob between two cells belongs to the cell whose (row + col) is even.
 * @param {number} r
 * @param {number} c
 * @param {number} cols
 * @param {number} rows
 * @returns {{top: number, right: number, bottom: number, left: number}}
 */
export function pieceEdges(r, c, cols, rows) {
  const even = (r + c) % 2 === 0;
  return {
    top: r > 0 ? ((r - 1 + c) % 2 === 0 ? -1 : 1) : 0,
    right: c < cols - 1 ? (even ? 1 : -1) : 0,
    bottom: r < rows - 1 ? (even ? 1 : -1) : 0,
    left: c > 0 ? ((r + c - 1) % 2 === 0 ? -1 : 1) : 0,
  };
}

/**
 * Knob points along an edge from (x0,y0) to (x1,y1). `nx, ny` is the outward normal; `sign` 1 = knob out,
 * -1 = notch in. Returns the intermediate points (the edge's own end points are added by the caller).
 */
function knobPoints(x0, y0, x1, y1, nx, ny, sign, size) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const neck = Math.min(size * 0.9, len * 0.14);
  const head = neck * 1.45;
  const d = size * sign;
  const pt = (along, out) => [mx + ux * along + nx * out, my + uy * along + ny * out];
  return [
    pt(-neck, 0), pt(-neck * 0.8, d * 0.3), pt(-head, d * 0.6), pt(-head * 0.75, d * 0.95), pt(0, d),
    pt(head * 0.75, d * 0.95), pt(head, d * 0.6), pt(neck * 0.8, d * 0.3), pt(neck, 0),
  ];
}

/**
 * Clip-path polygon (px) of one puzzle piece inside its padded box. The box is the cell plus `tab` on every
 * side, so knobs can protrude; the caller positions the box at (c*cellW - tab, r*cellH - tab).
 * @param {number} r
 * @param {number} c
 * @param {number} cols
 * @param {number} rows
 * @param {number} cellW
 * @param {number} cellH
 * @param {number} tab  knob size in px
 * @returns {{polygon: string, points: number[][], box: {x: number, y: number, w: number, h: number}}}
 */
export function piecePolygon(r, c, cols, rows, cellW, cellH, tab) {
  const e = pieceEdges(r, c, cols, rows);
  const x0 = tab, y0 = tab, x1 = tab + cellW, y1 = tab + cellH;
  const pts = [];
  // top edge: left -> right, outward = -y
  pts.push([x0, y0]);
  if (e.top) pts.push(...knobPoints(x0, y0, x1, y0, 0, -1, e.top, tab));
  pts.push([x1, y0]);
  // right edge: top -> bottom, outward = +x
  if (e.right) pts.push(...knobPoints(x1, y0, x1, y1, 1, 0, e.right, tab));
  pts.push([x1, y1]);
  // bottom edge: right -> left, outward = +y
  if (e.bottom) pts.push(...knobPoints(x1, y1, x0, y1, 0, 1, e.bottom, tab));
  pts.push([x0, y1]);
  // left edge: bottom -> top, outward = -x
  if (e.left) pts.push(...knobPoints(x0, y1, x0, y0, -1, 0, e.left, tab));
  const rounded = pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  return {
    polygon: `polygon(${rounded.map(([x, y]) => `${x}px ${y}px`).join(', ')})`,
    points: rounded,
    box: { x: c * cellW - tab, y: r * cellH - tab, w: cellW + 2 * tab, h: cellH + 2 * tab },
  };
}

/**
 * Layout of every piece of a hunt over a card art of `width` x `height` px.
 * @param {number} total  pieces needed
 * @param {number} owned  pieces owned (the first `owned` pieces are lit)
 * @param {number} width
 * @param {number} height
 * @param {number} [tab]  knob size (default 9 % of the cell's shorter side)
 * @returns {Array<{index: number, r: number, c: number, owned: boolean, polygon: string, box: object, bgX: number, bgY: number}>}
 */
export function pieceLayout(total, owned, width, height, tab) {
  const { cols, rows } = pieceGrid(total);
  const cellW = width / cols, cellH = height / rows;
  const t = tab == null ? Math.round(Math.min(cellW, cellH) * 0.09) : tab;
  const out = [];
  for (let i = 0; i < Math.max(1, total | 0); i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const p = piecePolygon(r, c, cols, rows, cellW, cellH, t);
    out.push({ index: i, r, c, owned: i < owned, polygon: p.polygon, box: p.box, bgX: -p.box.x, bgY: -p.box.y });
  }
  return out;
}

/** Size (px) of the card the original piece sprites cover (piece{N}_merge.png). */
export const PIECE_CARD = Object.freeze({ w: 451, h: 640 });

/**
 * The original puzzle overlays (comp_card_pieces_overlay: assets/gfx/hud/cardpieces/piece{N}/default): for a
 * hunt of 2, 4, 6 or 10 pieces, piece i is drawn as `piece{N}_{i}.png` (white outline over the art) when owned
 * and `piece{N}_{i}b.png` (dark cover) when missing. Positions are the client's table converted to px of the
 * 451 x 640 card: left = 2·(x + 67.75), top = 2·(y + 96) (the client centres each piece at -45 + w/2 + x,
 * -64 + h/2 + y units on a 225.5 x 320 unit card).
 * @type {Readonly<Record<number, ReadonlyArray<{id: number, x: number, y: number, w: number, h: number}>>>}
 */
const PIECE_TABLE = {
  2: [[-68, -96.5, 451, 323], [-68, 12.5, 451, 423]],
  4: [[-68, -96.5, 300, 323], [43.5, -96.5, 228, 394], [-68, 27.5, 229, 394], [8.5, 61.5, 299, 326]],
  6: [[-68, -96.5, 280, 216], [43.5, -96.5, 228, 216], [-68, -17, 229, 282], [18, -17, 279, 282], [-68, 96.5, 280, 255], [43.5, 96.5, 228, 255]],
  10: [[-68, -96.5, 150, 216], [-21, -96.5, 221, 216], [61, -96.5, 193, 216], [-68, -16.5, 124, 302], [-34, -16.5, 212, 302],
    [43.5, -16.5, 168, 302], [99, -16.5, 118, 302], [-68, 106.5, 150, 235], [-21, 106.5, 221, 235], [61, 106.5, 193, 235]],
};
export const PIECE_SPRITES = Object.freeze(Object.fromEntries(Object.entries(PIECE_TABLE).map(([n, rows]) => [n,
  Object.freeze(rows.map(([x, y, w, h], i) => Object.freeze({
    id: i + 1, x: Math.max(0, Math.round(2 * (x + 67.75))), y: Math.max(0, Math.round(2 * (y + 96))), w, h,
  })))])));

/**
 * Sprite layout of a hunt's puzzle overlay in percent of the card box, or null when the client has no sprite
 * set for that piece count (then the clip-path puzzle is drawn).
 * @param {number} total
 * @param {number} owned
 * @returns {Array<{index: number, owned: boolean, sprite: string, left: number, top: number, width: number, height: number}>|null}
 */
export function pieceSpriteLayout(total, owned) {
  const set = PIECE_SPRITES[total | 0];
  if (!set) return null;
  const pct = (v, of) => Math.round((v / of) * 10000) / 100;
  return set.map((p, i) => ({
    index: i,
    owned: i < (owned | 0),
    sprite: `piece${total | 0}_${p.id}${i < (owned | 0) ? '' : 'b'}`,
    left: pct(p.x, PIECE_CARD.w), top: pct(p.y, PIECE_CARD.h), width: pct(p.w, PIECE_CARD.w), height: pct(p.h, PIECE_CARD.h),
  }));
}

/**
 * "n / total" text and completion ratio of a hunt.
 * @param {{owned: number, total: number}} hunt
 * @returns {{text: string, ratio: number, missing: number}}
 */
export function huntProgress(hunt) {
  const total = Math.max(1, hunt.total | 0);
  const owned = Math.max(0, Math.min(total, hunt.owned | 0));
  return { text: `${owned} / ${total}`, ratio: owned / total, missing: total - owned };
}
