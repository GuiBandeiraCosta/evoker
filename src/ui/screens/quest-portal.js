'use strict';
/**
 * The portal gate of the quest maps: which portal runs now (the 7-day rotation, game.quests portalSchedule), the
 * banner over a map, and the level-8 lock (the client's locked-feature popup). Used by the map, the landing feed
 * and the quest screen.
 */
import { questLine, portalSchedule } from '../../game/quests.js';

/** Player level from which the portals can be entered (tutorial video 4:24: the portal swirl tapped at level 3
 *  answers with the server's locked-feature popup; the client's map2_screen shows
 *  getLockedFeatureMessages().portal in portalNotAvailablePopup while the 'eventmap' feature is locked). */
export const PORTAL_LEVEL = 8;
/** That popup's texts (server strings, from the German "Portale" / "Erreiche Benutzer-Level 8, um Portale zu betreten."). */
export const PORTAL_LOCKED = Object.freeze({ title: 'Portals', text: 'Reach user level 8 to enter portals.' });
/** Toast of a portal (map or quest) that has closed. */
export const PORTAL_CLOSED_TEXT = 'This portal has closed.';

/**
 * May the player enter the portals (player level >= PORTAL_LEVEL)?
 * @param {object} state
 * @returns {boolean}
 */
export function canEnterPortals(state) {
  return Boolean(state && state.player && (state.player.level | 0) >= PORTAL_LEVEL);
}

/**
 * The map a request may show: a portal map only for the running portal and from level 8; anything else (an ended
 * portal reached by a direct route or a stale return address, an unknown line, a portal below level 8) falls back
 * to the main map. `reason` says why ('closed' | 'level' | null).
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {string} [line]
 * @returns {{line: string, reason: 'closed'|'level'|null}}
 */
export function resolveMapLine(state, deps, now, line) {
  if (!line || line === 'main' || !questLine(deps, line)) return { line: 'main', reason: null };
  const run = runningPortal(state, deps, now);
  if (!run || run.portalId !== line) return { line: 'main', reason: 'closed' };
  if (!canEnterPortals(state)) return { line: 'main', reason: 'level' };
  return { line, reason: null };
}

/**
 * The running portal and the next one by the 7-day rotation (game.quests portalSchedule). A manual choice from the
 * former Portal archive (`state.quests.manualPortal`, still set in some old saves) is ignored:
 * the client only ever offered the scheduled portal.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @returns {{portalId: string, name: string, endsAt: number, next: {portalId: string, name: string, startsAt: number}|null}|null}
 */
export function runningPortal(state, deps, now) {
  const sched = portalSchedule(deps, state.createdAt, now);
  const portals = (deps.quests && deps.quests.portals) || [];
  if (!sched || !questLine(deps, sched.portalId)) return null;
  const nextDef = portals.length > 1 ? portals[(sched.index + 1) % portals.length] : null;
  return {
    portalId: sched.portalId, name: questLine(deps, sched.portalId).name, endsAt: sched.endsAt,
    next: nextDef ? { portalId: nextDef.id, name: nextDef.name, startsAt: sched.endsAt } : null,
  };
}

/**
 * The banner over a map: on the main map the running portal (its countdown; a tap enters it), on a portal map that
 * portal (the countdown only while it is the running one; no tap target). null when there are no portals.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {string} line  the map shown
 * @returns {{name: string, portalId: string, endsAt: number|null, target: string|null}|null}
 */
export function mapBanner(state, deps, now, line) {
  const run = runningPortal(state, deps, now);
  if (line === 'main' || !questLine(deps, line)) {
    return run ? { name: run.name, portalId: run.portalId, endsAt: run.endsAt, target: run.portalId } : null;
  }
  const def = questLine(deps, line);
  const running = Boolean(run && run.portalId === line);
  return { name: def.name, portalId: line, endsAt: running ? run.endsAt : null, target: null };
}

/**
 * Enter a portal map, or below level 8 show the client's locked-feature popup instead.
 * @param {object} ctx
 * @param {() => void} go  the navigation
 */
export function enterPortal(ctx, go) {
  if (canEnterPortals(ctx.store.get())) { go(); return; }
  ctx.ui.dialog.alert({ title: PORTAL_LOCKED.title, message: PORTAL_LOCKED.text });
}
