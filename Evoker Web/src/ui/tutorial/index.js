'use strict';
/**
 * The first-session tutorial (DECISIONS D1): progress and step script (progress.js), lines (lines.js), the
 * overlay manager (manager.js), the opening with the scripted Worm Shaman fight (opening.js) and the Arena
 * name prompt (name-popup.js). See docs/design/game-design.md §9.
 */
export { installTutorial, tutorial } from './manager.js';
export { runOpening, INTRO_LORE, SKIP_INTRO } from './opening.js';
export { maybeAskName, askPlayerName, NAME_PROMPT_TEXT } from './name-popup.js';
export {
  newTutorialGame, startTutorial, tutorialOf, isTutorialActive, hintFor, recordBossFight, needsName, setPlayerName,
  defaultPlayerName, FINAL_QUEST,
} from './progress.js';
export { LINES, SPEAKERS, line } from './lines.js';
