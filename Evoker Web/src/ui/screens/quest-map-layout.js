'use strict';
/**
 * Layout of the quest maps (pure apart from `loadLayout` / `whenLaidOut`): the stitched original world maps and
 * their painted sockets (assets/orig/map/layout.json, written by exploration/tools/build-map.py), the map scale, the drifting
 * clouds, and the winding path of the CSS painting drawn when the layout is missing.
 */

/** Vertical distance between nodes of the fallback painting (stage px). */
export const NODE_STEP = 104;
/** Top padding before the first node (fallback painting). */
export const MAP_TOP = 150;
/** Bottom padding after the last node (fallback painting). */
export const MAP_BOTTOM = 420;
/** Height of one cropped map tile of the fallback painting (see quest-map.css). */
export const TILE_H = 370;

/** The stitched maps and their node coordinates (written by exploration/tools/build-map.py). */
const LAYOUT_URL = '/assets/orig/map/layout.json';
/** Map pixels -> stage pixels (the original showed a 256 px tile at roughly 330 stage px; this keeps more
 *  of the world on screen while the painted sockets stay readable under the 64 px tokens). */
export const MAP_SCALE = 0.85;
/** Height of the map viewport (stage 1280 − HUD 118 − nav 136): a map is never drawn shorter, so it always
 *  reaches the nav (map2_screen: map height = screen height − 100). */
export const MAP_VIEW_H = 1026;
/** Portal lines with a themed map; the others cycle through the portal maps. */
export const PORTAL_MAPS = { 'the-dark-beyond': 1, 'dragon-hunt': 2, 'desert-twilight': 3, 'dying-dreams': 4 };
/** Drifting clouds: sprite, vertical position (fraction of the map height), duration (s), scale. */
export const CLOUDS = [
  { file: 'map_cloud01.png', y: 0.12, dur: 95, scale: 1.1, delay: 0 },
  { file: 'map_cloud02.png', y: 0.55, dur: 120, scale: 1.3, delay: -40 },
  { file: 'map_cloud03.png', y: 0.82, dur: 80, scale: 0.9, delay: -70 },
];

/**
 * Run `fn` once `el` is in the document and laid out. A pushed screen is built off-document (the fade
 * transition inserts it under the black curtain only after the old screen faded out), so a scroll position set
 * while building is lost; this polls until the element has a size (max ~4 s).
 * @param {HTMLElement} el
 * @param {() => void} fn
 */
export function whenLaidOut(el, fn) {
  let tries = 0;
  const check = () => {
    if (el.isConnected && el.clientHeight > 0) { fn(); return; }
    if (++tries < 80) setTimeout(check, 50);
  };
  check();
}

/**
 * Position of node `i` (0-based) on the winding path of the fallback painting.
 * @param {number} i
 * @returns {{x: number, y: number}}
 */
export function nodePos(i) {
  const x = Math.round(360 + 190 * Math.sin(i * 0.78) + 40 * Math.sin(i * 2.1));
  const y = MAP_TOP + i * NODE_STEP;
  return { x, y };
}

/**
 * The map of a quest line: the main map for 'main', a themed or cycled portal map otherwise.
 * @param {{maps: object[]}|null} layout
 * @param {string} line
 * @param {string[]} [portalIds]  all portal ids in order (for the cycling)
 * @returns {object|null}
 */
export function worldForLine(layout, line, portalIds = []) {
  if (!layout || !Array.isArray(layout.maps) || !layout.maps.length) return null;
  const maps = layout.maps.filter((m) => m && m.width >= 512 && m.height >= 512);
  if (!maps.length) return null;
  if (line === 'main') return maps[0];
  const portalMaps = maps.slice(1);
  if (!portalMaps.length) return maps[0];
  if (PORTAL_MAPS[line] && maps[PORTAL_MAPS[line]]) return maps[PORTAL_MAPS[line]];
  const idx = Math.max(0, portalIds.indexOf(line));
  return portalMaps[idx % portalMaps.length];
}

/**
 * Fit a socket chain to exactly `count` nodes. The shipped layout has exactly one painted socket per quest
 * on every map (the hand-checked routes of exploration/tools/build-map.py), so this is the identity there; for a map
 * with a different count: too many -> drop the nodes that deviate least from the line between their
 * neighbours (shortcut-able ones, never the ends); too few -> add nodes on the segments, spread evenly
 * over the longest ones (largest possible smallest gap, no midpoints stacked on one segment).
 * @param {{x: number, y: number}[]} nodes  route order
 * @param {number} count
 * @returns {{x: number, y: number}[]}
 */
export function fitNodes(nodes, count) {
  let pts = nodes.map((p) => ({ x: p.x, y: p.y }));
  if (pts.length < 2 || count < 2) return pts.slice(0, count);
  while (pts.length > count) {
    let best = -1;
    let bestDev = Infinity;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const dev = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len;
      if (dev < bestDev) { bestDev = dev; best = i; }
    }
    pts.splice(best, 1);
  }
  if (pts.length < count) {
    // extra nodes go on the painted roads (the straight segments), spread evenly: each one goes to the
    // segment whose pieces would stay longest, so the smallest gap between nodes is as large as possible
    const lens = pts.slice(0, -1).map((p, i) => Math.hypot(pts[i + 1].x - p.x, pts[i + 1].y - p.y));
    const extra = lens.map(() => 0);
    for (let n = pts.length; n < count; n++) {
      let best = 0;
      for (let i = 1; i < lens.length; i++) if (lens[i] / (extra[i] + 2) > lens[best] / (extra[best] + 2)) best = i;
      extra[best]++;
    }
    const out = [];
    pts.forEach((p, i) => {
      out.push(p);
      if (i >= lens.length) return;
      const q = pts[i + 1];
      for (let k = 1; k <= extra[i]; k++) {
        const t = k / (extra[i] + 1);
        out.push({ x: Math.round(p.x + (q.x - p.x) * t), y: Math.round(p.y + (q.y - p.y) * t) });
      }
    });
    pts = out;
  }
  return pts;
}

/**
 * Node coordinates (map pixels) for `count` quests on a map: the painted sockets in route order (layout
 * `nodes`, quest 1 first; fitted to the count if it differs), else a serpentine through the map in lanes.
 * @param {{width: number, height: number, nodes?: {x: number, y: number}[]}} world
 * @param {number} count
 * @returns {{x: number, y: number}[]}
 */
export function nodeCoords(world, count, spacing = 230) {
  const nodes = (world && world.nodes) || [];
  if (nodes.length >= count * 0.7 && nodes.length >= 2) return fitNodes(nodes, count);
  const W = world.width;
  const H = world.height;
  // snake along the long axis of the map in lanes about `spacing` map px apart
  const vertical = H > W;
  const long = vertical ? H : W;
  const short = vertical ? W : H;
  const mL = Math.min(260, long * 0.08);
  const mS = Math.min(220, short * 0.12);
  const usableL = long - 2 * mL;
  const usableS = short - 2 * mS;
  let capacity = Math.max(2, Math.floor(usableL / spacing) + 1);
  let lanes = Math.max(1, Math.ceil(count / capacity));
  const maxLanes = Math.max(1, Math.floor(usableS / 200) + 1);
  if (lanes > maxLanes) { lanes = maxLanes; capacity = Math.ceil(count / lanes); }
  const pitch = lanes > 1 ? usableS / (lanes - 1) : 0;
  const out = [];
  for (let i = 0; i < count; i++) {
    const lane = Math.floor(i / capacity);
    const k = i - lane * capacity;
    const n = Math.min(capacity, count - lane * capacity);
    const t = n > 1 ? k / (n - 1) : 0.5;
    const tl = lane % 2 ? 1 - t : t;
    const a = mL + tl * usableL;
    const wobble = Math.sin(i * 1.7) * Math.min(90, (pitch || usableS) * 0.22);
    const b = (lanes > 1 ? mS + lane * pitch : short / 2) + wobble;
    out.push(vertical ? { x: Math.round(b), y: Math.round(a) } : { x: Math.round(a), y: Math.round(b) });
  }
  return out;
}

/**
 * Stage-px scale of a painted map: MAP_SCALE, raised for a map that would end above the nav.
 * @param {{height: number}} world
 * @returns {number}
 */
export function mapScale(world) {
  return world && world.height > 0 ? Math.max(MAP_SCALE, MAP_VIEW_H / world.height) : MAP_SCALE;
}

/** @type {Promise<object|null>|null} */
let layoutPromise = null;

/**
 * Fetch (once) the stitched-map layout; null when unavailable.
 * @returns {Promise<object|null>}
 */
export function loadLayout() {
  if (!layoutPromise) {
    layoutPromise = (typeof fetch === 'function' ? fetch(LAYOUT_URL) : Promise.reject(new Error('no fetch')))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return layoutPromise;
}

/**
 * SVG path through points (drawn under the tokens).
 * @param {{x: number, y: number}[]} pts
 * @returns {string}
 */
export function pathD(pts) {
  return pts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ' ' + p.y).join(' ');
}
