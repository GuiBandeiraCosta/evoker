'use strict';
/**
 * Portrait stage: a fixed 720 x 1280 logical canvas scaled with transform: scale() to fit the viewport,
 * centred and letterboxed with a dark vignette on wide screens, filling the width on phones.
 */
import { h } from '../dom.js';

export const STAGE_WIDTH = 720;
export const STAGE_HEIGHT = 1280;

/**
 * Compute the scale and offsets that fit a logical stage into a viewport.
 * @param {number} vw viewport width
 * @param {number} vh viewport height
 * @param {number} [w=STAGE_WIDTH]
 * @param {number} [hgt=STAGE_HEIGHT]
 * @returns {{scale: number, x: number, y: number}}
 */
export function fitStage(vw, vh, w = STAGE_WIDTH, hgt = STAGE_HEIGHT) {
  const scale = Math.max(0.05, Math.min(vw / w, vh / hgt));
  const x = Math.round((vw - w * scale) / 2);
  const y = Math.round((vh - hgt * scale) / 2);
  return { scale, x, y };
}

/**
 * Create the stage inside `root` (usually #app).
 * @param {HTMLElement} root
 * @param {{width?: number, height?: number, id?: string}} [opts]
 * @returns {{
 *   el: HTMLElement, wrap: HTMLElement, layer: HTMLElement,
 *   fit: () => {scale: number, x: number, y: number},
 *   getScale: () => number,
 *   toStage: (clientX: number, clientY: number) => {x: number, y: number},
 *   destroy: () => void
 * }}
 */
export function createStage(root, opts = {}) {
  const width = opts.width || STAGE_WIDTH;
  const height = opts.height || STAGE_HEIGHT;
  const layer = h('div.screen-layer');
  const el = h('div', { id: opts.id || 'stage', style: { '--stage-w': String(width), '--stage-h': String(height) } }, layer);
  const wrap = h('div.stage-wrap', null, el);
  root.appendChild(wrap);

  let current = { scale: 1, x: 0, y: 0 };

  function fit() {
    const vw = wrap.clientWidth || window.innerWidth;
    const vh = wrap.clientHeight || window.innerHeight;
    current = fitStage(vw, vh, width, height);
    el.style.setProperty('--stage-scale', String(current.scale));
    el.style.setProperty('--stage-x', current.x + 'px');
    el.style.setProperty('--stage-y', current.y + 'px');
    document.documentElement.style.setProperty('--stage-scale', String(current.scale));
    return current;
  }

  function toStage(clientX, clientY) {
    const rect = el.getBoundingClientRect();
    return { x: (clientX - rect.left) / current.scale, y: (clientY - rect.top) / current.scale };
  }

  const onResize = () => fit();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  fit();

  return {
    el,
    wrap,
    layer,
    fit,
    getScale: () => current.scale,
    toStage,
    destroy() {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize);
      wrap.remove();
    },
  };
}
