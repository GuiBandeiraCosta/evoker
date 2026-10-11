'use strict';
/**
 * Settings model of the Options screen: the four classic fields (sound, battle speed, simulated raids, reduced
 * motion) and the two audio volumes. Pure and DOM-free (tests/economy-ui.test.js, tests/audio.test.js).
 */

export const SPEEDS = [1, 2];
/** Defaults of the classic fields (a save always carries `sound`: migrate fills it, see game/state.js). */
const DEFAULT_SETTINGS = Object.freeze({ sound: false, speed: 1, raids: true, reducedMotion: false });
/** Default volumes (0..1) of the two audio channels; the Settings sliders show them as 0-100. */
export const DEFAULT_VOLUMES = Object.freeze({ musicVolume: 0.7, fxVolume: 1 });

/**
 * Fill missing settings with defaults and coerce types (speed 1 or 2, booleans).
 * @param {object|null|undefined} settings
 * @returns {{sound: boolean, speed: number, raids: boolean, reducedMotion: boolean}}
 */
export function normalizeSettings(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const speed = SPEEDS.includes(Number(s.speed)) ? Number(s.speed) : DEFAULT_SETTINGS.speed;
  return {
    sound: s.sound === undefined ? DEFAULT_SETTINGS.sound : Boolean(s.sound),
    speed,
    raids: s.raids === undefined ? DEFAULT_SETTINGS.raids : Boolean(s.raids),
    reducedMotion: s.reducedMotion === undefined ? DEFAULT_SETTINGS.reducedMotion : Boolean(s.reducedMotion),
  };
}

/**
 * Clamp a volume to 0..1 (two decimals); anything that is not a finite number becomes `fallback`.
 * @param {any} v
 * @param {number} fallback
 * @returns {number}
 */
export function clampVolume(v, fallback) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}

/**
 * The two audio volumes of a settings object, filled with defaults and clamped to 0..1.
 * Kept apart from `normalizeSettings` so the older four-field shape stays unchanged.
 * @param {object|null|undefined} settings
 * @returns {{musicVolume: number, fxVolume: number}}
 */
export function normalizeVolumes(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    musicVolume: clampVolume(s.musicVolume, DEFAULT_VOLUMES.musicVolume),
    fxVolume: clampVolume(s.fxVolume, DEFAULT_VOLUMES.fxVolume),
  };
}

/**
 * Slider position (0-100) -> volume (0..1).
 * @param {any} n
 * @returns {number}
 */
export function sliderToVolume(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.max(0, Math.min(100, v))) / 100;
}

/**
 * Volume (0..1) -> slider position (0-100, integer).
 * @param {any} v
 * @returns {number}
 */
export function volumeToSlider(v) {
  return Math.round(clampVolume(v, 0) * 100);
}
