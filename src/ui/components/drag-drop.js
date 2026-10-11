'use strict';
/**
 * Pointer-based drag and drop of cards between deck slots (mouse + touch via Pointer Events).
 * The dragged card is cloned into a ghost that tilts -6 degrees and glows blue; the source fades to a
 * placeholder; the slot under the pointer highlights; dropping outside returns the card.
 *
 * Draggables are elements matching `draggableSelector` (default `.card[data-draggable]`, which renderCard
 * emits with `draggable: true`). Drop zones match `slotSelector` (default `.deck-slot[data-slot]`).
 * A draggable inside a drop zone reports that zone's index as `from`; otherwise `from` is null (drawer).
 * Drop zones may carry `data-zone` (a name) instead of / besides `data-slot`; it is reported as `zone` / `fromZone`.
 * `shouldStart` can refuse a drag once the pointer moved past the threshold (e.g. a horizontal swipe that
 * scrolls a card carousel), and the ghost keeps the card's layout size, so a card scaled by an inline transform
 * (carousel) is dragged at its natural size.
 */
import { h } from '../dom.js';

const DRAG_THRESHOLD = 6;

/**
 * @typedef {object} DropInfo
 * @property {string|undefined} uid  data-uid of the dragged card
 * @property {string|undefined} cardId
 * @property {number|null} from  slot index the card came from (null = drawer / collection)
 * @property {number|null} to  slot index dropped on (null = outside)
 * @property {string|null} zone  `data-zone` of the target drop zone (null = none)
 * @property {string|null} fromZone  `data-zone` of the drop zone the card came from (null = none)
 * @property {HTMLElement} el  the dragged element
 * @property {HTMLElement|null} slotEl  the target slot element
 */

/**
 * @typedef {object} DragDropOptions
 * @property {HTMLElement} container  element the ghost is positioned in (the screen or stage)
 * @property {string} [slotSelector='.deck-slot[data-slot]']
 * @property {string} [draggableSelector='.card[data-draggable]']
 * @property {() => number} [getScale]  stage scale (client px per stage px); defaults to measuring the container
 * @property {(info: DropInfo) => boolean} [canDrop]  return false to show the red highlight and refuse
 * @property {(info: DropInfo) => void} [onDrop]  called for a valid drop on a slot
 * @property {(info: DropInfo) => void} [onDropOutside]  called when released outside any slot (the card glides back)
 * @property {(info: DropInfo) => void} [onDropInvalid]  called when released on a slot that canDrop refused (the card glides back)
 * @property {(info: DropInfo, dx: number, dy: number) => boolean} [shouldStart]  called once the pointer moved past
 *           the threshold (dx / dy in client px); return false to let the gesture go (no drag, no tap)
 * @property {(info: DropInfo) => void} [onDragStart]
 * @property {(info: DropInfo) => void} [onDragEnd]  always called after a drag (after onDrop/onDropOutside)
 * @property {(ev: PointerEvent, el: HTMLElement) => void} [onTap]  pointer released without dragging
 */

/**
 * Create a drag controller on a container.
 * @param {DragDropOptions} opts
 * @returns {{destroy: () => void, enable: () => void, disable: () => void, dragging: () => boolean}}
 */
export function createDragDrop(opts) {
  const container = opts.container;
  const slotSelector = opts.slotSelector || '.deck-slot[data-slot]';
  const draggableSelector = opts.draggableSelector || '.card[data-draggable]';
  let enabled = true;
  /** @type {null | {el: HTMLElement, ghost: HTMLElement, startX: number, startY: number, offX: number, offY: number, active: boolean, pointerId: number, from: number|null, fromZone: string|null, target: HTMLElement|null, valid: boolean, w: number, h: number}} */
  let drag = null;

  function scale() {
    if (opts.getScale) return opts.getScale() || 1;
    const rect = container.getBoundingClientRect();
    return container.offsetWidth ? rect.width / container.offsetWidth : 1;
  }

  function slotIndex(slotEl) {
    if (!slotEl) return null;
    const n = Number(slotEl.dataset.slot);
    return Number.isFinite(n) ? n : null;
  }

  function zoneOf(slotEl) {
    return slotEl && slotEl.dataset && slotEl.dataset.zone ? slotEl.dataset.zone : null;
  }

  function info(target) {
    return {
      uid: drag.el.dataset.uid,
      cardId: drag.el.dataset.cardId,
      from: drag.from,
      to: slotIndex(target),
      zone: zoneOf(target),
      fromZone: drag.fromZone,
      el: drag.el,
      slotEl: target || null,
    };
  }

  function clearTarget() {
    if (drag && drag.target) {
      drag.target.classList.remove('drop-target', 'drop-invalid');
      drag.target = null;
    }
  }

  function positionGhost(clientX, clientY) {
    const s = scale();
    const rect = container.getBoundingClientRect();
    const x = (clientX - rect.left) / s - drag.offX;
    const y = (clientY - rect.top) / s - drag.offY;
    drag.ghost.style.left = `${x}px`;
    drag.ghost.style.top = `${y}px`;
  }

  function begin(ev) {
    const s = scale();
    const rect = drag.el.getBoundingClientRect();
    // the ghost has the element's layout size (an inline transform, e.g. a carousel's scale, is dropped);
    // the grab point keeps its relative position inside the card
    const bw = rect.width / s, bh = rect.height / s;
    const lw = drag.el.offsetWidth || bw, lh = drag.el.offsetHeight || bh;
    drag.w = lw;
    drag.h = lh;
    drag.offX = ((ev.clientX - rect.left) / s) * (bw ? lw / bw : 1);
    drag.offY = ((ev.clientY - rect.top) / s) * (bh ? lh / bh : 1);
    const ghost = /** @type {HTMLElement} */ (drag.el.cloneNode(true));
    ghost.classList.remove('drag-source', 'selected');
    ghost.removeAttribute('id');
    for (const k of ['transform', 'left', 'top', 'position', 'opacity', 'zIndex']) ghost.style[k] = '';
    drag.ghost = h('div.drag-ghost', { style: { width: `${drag.w}px`, height: `${drag.h}px` } }, ghost);
    container.appendChild(drag.ghost);
    drag.el.classList.add('drag-source');
    drag.active = true;
    positionGhost(ev.clientX, ev.clientY);
    if (opts.onDragStart) opts.onDragStart(info(null));
  }

  function onPointerDown(ev) {
    if (!enabled || drag || ev.button > 0) return;
    const target = ev.target instanceof Element ? ev.target.closest(draggableSelector) : null;
    if (!target || !container.contains(target)) return;
    const slotEl = target.closest(slotSelector);
    drag = {
      el: /** @type {HTMLElement} */ (target), ghost: null, startX: ev.clientX, startY: ev.clientY,
      offX: 0, offY: 0, active: false, pointerId: ev.pointerId, from: slotIndex(slotEl), fromZone: zoneOf(slotEl), target: null, valid: false, w: 0, h: 0,
    };
    try { target.setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      const dx = ev.clientX - drag.startX, dy = ev.clientY - drag.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (opts.shouldStart && opts.shouldStart(info(null), dx, dy) === false) { finish(false); return; }
      begin(ev);
    }
    ev.preventDefault();
    positionGhost(ev.clientX, ev.clientY);
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const slot = under ? /** @type {HTMLElement|null} */ (under.closest(slotSelector)) : null;
    if (slot !== drag.target) {
      clearTarget();
      if (slot && container.contains(slot)) {
        drag.target = slot;
        drag.valid = opts.canDrop ? opts.canDrop(info(slot)) !== false : true;
        slot.classList.add(drag.valid ? 'drop-target' : 'drop-invalid');
      }
    }
  }

  function finish(returned) {
    const d = drag;
    drag = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    try { d.el.releasePointerCapture(d.pointerId); } catch (_) { /* ignore */ }
    if (!d.active) return;
    d.el.classList.remove('drag-source');
    if (returned && d.ghost) {
      // glide the ghost back to the source, then remove it
      const s = scale();
      const rect = d.el.getBoundingClientRect();
      const crect = container.getBoundingClientRect();
      d.ghost.style.transition = 'left 180ms ease, top 180ms ease, transform 180ms ease';
      d.ghost.style.left = `${(rect.left - crect.left) / s}px`;
      d.ghost.style.top = `${(rect.top - crect.top) / s}px`;
      d.ghost.style.transform = 'none';
      setTimeout(() => d.ghost.remove(), 190);
    } else if (d.ghost) {
      d.ghost.remove();
    }
  }

  function onPointerUp(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const d = drag;
    if (!d.active) {
      finish(false);
      if (opts.onTap && ev.type === 'pointerup') opts.onTap(ev, d.el);
      return;
    }
    const target = d.target;
    const valid = d.valid;
    const result = info(target);
    clearTarget();
    const dropped = Boolean(target) && valid && ev.type === 'pointerup';
    finish(!dropped);
    if (dropped) { if (opts.onDrop) opts.onDrop(result); }
    else if (target && ev.type === 'pointerup') { if (opts.onDropInvalid) opts.onDropInvalid(result); }
    else if (opts.onDropOutside && ev.type === 'pointerup') opts.onDropOutside(result);
    if (opts.onDragEnd) opts.onDragEnd(result);
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.style.touchAction = container.style.touchAction || 'none';

  return {
    destroy() {
      container.removeEventListener('pointerdown', onPointerDown);
      if (drag) finish(true);
    },
    enable() { enabled = true; },
    disable() { enabled = false; if (drag) finish(true); },
    dragging: () => Boolean(drag && drag.active),
  };
}
