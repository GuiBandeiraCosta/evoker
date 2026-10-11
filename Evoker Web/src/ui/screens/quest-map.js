'use strict';
/**
 * Quest tab: the quest map, and once per login the landing feed.
 *
 * params: {}                the main quest map (the nav's map button: menubar_comp mapBtnCallback always
 *                           pushes ui.screens.map2.map2_screen, the main map)
 *         { line }          the map of a quest line ('main' or a portal id; ui.screens.eventmaps.eventmap_screen
 *                           for a portal, entered from the main map; ctrl_bossquest returns there after a fight)
 *         { feed: true }    the landing feed of the login and the home button (quest-feed.js)
 *
 * Quest map (game-design §4): the current portal's banner with its countdown over the top of the map (map2_screen
 * puts questmanager.getBanner(), a microbanner_comp image with a timer label at the right, at y = 81 over the map; the
 * map itself fills the screen down to the nav, height = screen − 100). On the main map the banner is the running
 * portal's and a tap enters that portal (the client entered it through the portal animation on the map); on a portal
 * map it names that portal. There is no portal archive: map2_screen only places portals whose `timing` is running,
 * so an ended portal cannot be entered until the rotation brings it back (its quest progress stays in the save).
 * Below the banner: the original painted world map (the 256 px tiles of assets/orig/prepackaged re-assembled by
 * exploration/tools/build-map.py into assets/orig/map/world-*.jpg, scrolling in both directions), the quest nodes on the painted
 * sockets (as in 1.7.4: beaten = small grey numbered badges, current = dark badge in the golden fx_glow_map pentagram
 * ring, locked = just the painted socket under an invisible tap target; one socket per quest, joined by the painted
 * roads), drifting map clouds, the ranger guide with her speech bubble, HUD and nav. Without the layout (file
 * missing, no fetch) the previous CSS painting with a winding path is drawn instead. Layout maths:
 * quest-map-layout.js; the running portal and the level-8 gate: quest-portal.js.
 *
 * Stable hooks (tutorial, QA): `.qm-node[data-quest][data-status]`, `.qm-banner` (+ `.qm-banner-name`,
 * `.qm-countdown`, `data-target`), `.qm-feed`, `.feed-banner[data-feed]` (`[data-feed="quest"]` = Main Quest).
 */
import { h, svg, keyActivate } from '../dom.js';
import { screenBody } from '../chrome.js';
import { mapNodes, guideLine } from '../../game/quests.js';
import { pendingUnlocks, markSeen } from '../components/popup-unlock.js';
import {
  NODE_STEP, MAP_TOP, MAP_BOTTOM, TILE_H, CLOUDS, whenLaidOut, nodePos, worldForLine, nodeCoords, mapScale, loadLayout, pathD,
} from './quest-map-layout.js';
import { resolveMapLine, mapBanner, enterPortal, PORTAL_CLOSED_TEXT } from './quest-portal.js';
import { isFeedView, renderFeed } from './quest-feed.js';

/** The fx_glow_map rune circle drawn around the current node. */
function runeCircle() {
  return h('img.qm-rune', { src: '/assets/orig/ui/fx_glow_map.png', alt: '', draggable: 'false' });
}

/**
 * Node button.
 * @param {object} ctx
 * @param {string} line
 * @param {{n: number, status: string, quest: object}} node
 * @param {{x: number, y: number}} p  stage px inside the map
 */
function nodeButton(ctx, line, node, p) {
  return h('button.qm-node', {
    type: 'button',
    class: node.status,
    style: { left: p.x + 'px', top: p.y + 'px' },
    dataset: { quest: String(node.n), status: node.status },
    'aria-label': `Quest ${node.n} (${node.status})`,
    title: node.quest.sectionName ? `${node.quest.sectionName} - quest ${node.n}` : `Quest ${node.n}`,
    onClick: () => {
      if (node.status === 'locked') { ctx.ui.toast(`Beat quest ${node.n - 1} first!`, { icon: 'lock' }); return; }
      ctx.go('quest', { line, quest: node.n });
    },
  }, h('span.qm-node-num', null, String(node.n)));
}

/**
 * Show the unlock popups the save still owes (once each), while `root` stays on screen.
 * @param {object} ctx
 * @param {object} state
 */
function catchUpUnlocks(ctx, state) {
  const pending = pendingUnlocks(state);
  if (pending.silent.length) ctx.store.update((s) => markSeen(s, pending.silent));
  if (!pending.show.length) return;
  setTimeout(() => {
    // Only while this screen is still showing (goTop closes dialogs; do not follow the player around).
    if (!ctx.root.isConnected) return;
    ctx.ui.showUnlocks(pending.show, { isAlive: () => ctx.root.isConnected });
  }, 500);
}

export const screen = {
  /** @param {object} ctx */
  async render(ctx) {
    const state = ctx.store.get();
    if (!state) { ctx.replace('title'); return; }
    if (isFeedView(ctx.params)) { renderFeed(ctx, state); catchUpUnlocks(ctx, state); return; }
    const deps = ctx.deps;
    const t = ctx.now();
    // an ended portal (direct route, stale return address) or a portal below level 8 shows the main map
    const resolved = resolveMapLine(state, deps, t, ctx.params.line || 'main');
    const line = resolved.line;
    if (resolved.reason === 'closed') setTimeout(() => { if (ctx.root.isConnected) ctx.ui.toast(PORTAL_CLOSED_TEXT, { icon: 'compass' }); }, 700);
    const nodes = mapNodes(state, deps, line);
    const sections = line === 'main' ? (deps.quests.sections || []) : [];
    const layout = await loadLayout();
    const portalIds = (deps.quests.portals || []).map((p) => p.id);
    const world = worldForLine(layout, line, portalIds);

    // the main map is the Quest tab's root; a portal map goes back to it
    ctx.chrome.mount({ active: 'quest', back: line === 'main' ? false : () => ctx.back('quest-map'), help: 'quest-map' });
    const body = screenBody(ctx, world ? 'qm-body world' : 'qm-body');

    /* ---------- portal banner (microbanner_comp: painted strip, timer label at the right) ---------- */
    const info = mapBanner(state, deps, t, line);
    if (info) {
      const enter = () => { if (info.target) enterPortal(ctx, () => ctx.go('quest-map', { line: info.target }, { transition: 'fade' })); };
      const art = worldForLine(layout, info.portalId, portalIds);
      const strip = art && art.strips && art.strips[0] ? art.strips[0].file : null;
      const banner = h('div.portal-banner.qm-banner', {
        class: info.target ? 'tappable' : undefined,
        dataset: { portal: info.portalId, target: info.target || undefined },
        style: strip ? { '--qm-banner-art': `url('/assets/orig/map/${strip}')` } : undefined,
        ...(info.target ? { role: 'button', tabIndex: 0, title: `Enter ${info.name}`, onClick: enter, onKeydown: keyActivate(enter) } : {}),
      },
        h('span.qm-banner-name', null, info.name),
        info.endsAt ? ctx.ui.createCountdown({ endsAt: info.endsAt, getNow: ctx.now, className: 'qm-countdown' }) : null);
      body.appendChild(h('div.qm-top', null, banner));
    }

    /* ---------- the map ---------- */
    const count = nodes.length;
    let map;
    let currentPt = null;
    /** The rune circle on the current node and a button on every node, at the given map points. */
    const placeNodes = (pts) => nodes.forEach((node, i) => {
      const p = pts[i];
      if (node.status === 'current') {
        map.appendChild(h('div.qm-current', { style: { left: p.x + 'px', top: p.y + 'px' } }, runeCircle()));
        currentPt = p;
      }
      map.appendChild(nodeButton(ctx, line, node, p));
    });
    if (world) {
      const sc = mapScale(world);
      const W = Math.round(world.width * sc);
      const H = Math.round(world.height * sc);
      map = h('div.qm-map.qm-world', { class: line === 'main' ? 'main' : 'portal', style: { width: W + 'px', height: H + 'px' } });
      for (const s of world.strips || []) {
        map.appendChild(h('img.qm-strip', {
          src: '/assets/orig/map/' + s.file, alt: '', draggable: 'false',
          style: { left: Math.round(s.x * sc) + 'px', top: Math.round(s.y * sc) + 'px', width: Math.round(s.w * sc) + 'px', height: Math.round(s.h * sc) + 'px' },
        }));
      }
      const coords = nodeCoords(world, count).map((p) => ({ x: Math.round(p.x * sc), y: Math.round(p.y * sc) }));
      const painted = (world.nodes || []).length >= count;
      if (!painted) {
        map.appendChild(svg('svg', { class: 'qm-path', viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' },
          svg('path', { d: pathD(coords), class: 'shadow' }),
          svg('path', { d: pathD(coords), class: 'line' })));
      }
      map.appendChild(h('div.qm-map-tint'));
      CLOUDS.forEach((c, i) => map.appendChild(h('img.qm-cloud', {
        src: '/assets/orig/ui/' + c.file, alt: '', draggable: 'false',
        style: { top: Math.round(c.y * H) + 'px', '--dur': c.dur + 's', '--delay': c.delay + 's', '--scale': String(c.scale), '--w': W + 'px' },
      })));
      for (const sec of sections) {
        const i = sec.from - 1;
        if (i < 0 || i >= count) continue;
        const p = coords[i];
        map.appendChild(h('div.qm-section.plate', { class: p.x > W / 2 ? 'left' : 'right', style: { left: p.x + 'px', top: (p.y - 62) + 'px' } }, sec.name));
      }
      placeNodes(coords);
    } else {
      /* fallback: the CSS painting with the winding path */
      const height = MAP_TOP + Math.max(0, count - 1) * NODE_STEP + MAP_BOTTOM;
      map = h('div.qm-map', { class: line === 'main' ? 'main' : 'portal', style: { height: height + 'px' } });
      const tiles = Math.ceil(height / TILE_H);
      for (let i = 0; i < tiles; i++) {
        map.appendChild(h('div.qm-tile', { class: i % 2 ? 'flip' : undefined, style: { top: (i * TILE_H) + 'px' } },
          h('div.qm-tile-half.coast'), h('div.qm-tile-half.hills')));
      }
      map.appendChild(h('div.qm-map-tint'));
      const pts = Array.from({ length: count }, (_, i) => nodePos(i));
      map.appendChild(svg('svg', { class: 'qm-path', viewBox: `0 0 720 ${height}`, width: 720, height, 'aria-hidden': 'true' },
        svg('path', { d: pathD(pts), class: 'shadow' }),
        svg('path', { d: pathD(pts), class: 'line' })));
      for (const sec of sections) {
        const i = sec.from - 1;
        if (i < 0 || i >= count) continue;
        const p = nodePos(i);
        map.appendChild(h('div.qm-section.plate', { class: p.x > 360 ? 'left' : 'right', style: { top: (p.y - 22) + 'px' } }, sec.name));
      }
      placeNodes(pts);
    }
    body.appendChild(map);

    /* ---------- guide ---------- */
    const lineText = guideLine(state, { lastLoss: Boolean(ctx.params.lastLoss) });
    if (lineText) {
      const guide = h('div.qm-guide', { onClick: () => guide.classList.add('hidden') },
        h('img.qm-guide-portrait', { src: '/assets/ui/guide-ranger.jpg', alt: 'Ranger guide', draggable: 'false' }),
        h('div.guide-bubble.qm-bubble', null, lineText));
      body.appendChild(guide);
    }

    /* ---------- scroll to the current node ---------- */
    const scrollTo = () => {
      if (!currentPt) { body.scrollTop = 0; body.scrollLeft = 0; return; }
      if (world) {
        // the original centres the current node horizontally, at about 40 % of the height
        body.scrollLeft = Math.max(0, currentPt.x - (body.clientWidth || 720) / 2);
        body.scrollTop = Math.max(0, currentPt.y - (body.clientHeight || 1000) * 0.4);
      } else {
        body.scrollTop = Math.max(0, currentPt.y - 520);
      }
    };
    scrollTo();
    whenLaidOut(body, scrollTo);

    /* ---------- unlock popups the save still owes (card slots after a boss, level features) ---------- */
    catchUpUnlocks(ctx, state);
  },
};
