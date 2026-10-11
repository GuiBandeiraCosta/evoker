/**
 * Entry point so that the contract's `node --test tests/` works on Node 22
 * (the runner resolves the directory through this index). It imports every
 * suite in this folder; `node --test` or `npm test` still discover the
 * `*.test.js` files directly and never pick this file up twice.
 */
import './abilities.test.js';
import './app.test.js';
import './audio.test.js';
import './battle-player.test.js';
import './battle-ui.test.js';
import './battle.test.js';
import './cards-ui.test.js';
import './cdp.test.js';
import './data-wiki.test.js';
import './data.test.js';
import './economy-ui.test.js';
import './game-cards.test.js';
import './game-pvp.test.js';
import './game-quests.test.js';
import './lab-effects.test.js';
import './prune.test.js';
import './game-state.test.js';
import './integration.test.js';
import './league.test.js';
import './menus.test.js';
import './pvp-ui.test.js';
import './quest-ui.test.js';
import './shop.test.js';
import './stats.test.js';
import './tutorial.test.js';
import './ui.test.js';
