'use strict';
/**
 * Save files of the Options screen: validation of an imported save, the pretty JSON and the file name of an
 * export. Pure and DOM-free (tests/economy-ui.test.js).
 */
import { utcDay, SAVE_VERSION } from '../../game/state.js';

/**
 * Validate a parsed save object before importing it.
 * @param {any} save
 * @returns {{ok: true, save: object}|{ok: false, error: string}}
 */
export function validateSave(save) {
  if (!save || typeof save !== 'object' || Array.isArray(save)) return { ok: false, error: 'Not an Evoker save file.' };
  if (!Number.isInteger(save.version) || save.version < 1) return { ok: false, error: 'The save file has no version number.' };
  if (save.version > SAVE_VERSION) return { ok: false, error: `The save file is from a newer version (${save.version}).` };
  const p = save.player;
  if (!p || typeof p !== 'object') return { ok: false, error: 'The save file has no player.' };
  if (!Number.isInteger(p.level) || p.level < 1) return { ok: false, error: 'The player level is invalid.' };
  if (typeof p.name !== 'string') return { ok: false, error: 'The player name is invalid.' };
  if (!Array.isArray(save.cards)) return { ok: false, error: 'The card collection is missing.' };
  for (const c of save.cards) {
    if (!c || typeof c.uid !== 'string' || typeof c.cardId !== 'string') return { ok: false, error: 'A card entry is malformed.' };
  }
  if (save.deck !== undefined && !Array.isArray(save.deck)) return { ok: false, error: 'The deck is malformed.' };
  return { ok: true, save };
}

/**
 * Parse and validate the text of a save file.
 * @param {string} text
 * @returns {{ok: true, save: object}|{ok: false, error: string}}
 */
export function parseSaveFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text));
  } catch (err) {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  return validateSave(parsed);
}

/**
 * Pretty JSON for the export download.
 * @param {object} state
 * @returns {string}
 */
export function serializeSave(state) {
  return JSON.stringify(state, null, 2);
}

/**
 * File name of an exported save ("evoker-save-2026-10-07.json").
 * @param {number} now
 * @returns {string}
 */
export function saveFileName(now) {
  return `evoker-save-${utcDay(now)}.json`;
}
