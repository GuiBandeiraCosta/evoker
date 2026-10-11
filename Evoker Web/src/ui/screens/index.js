'use strict';
/**
 * Screen registry (architecture 8.3): screen id -> the `screen = { render, onLeave?, noChrome? }` object each
 * screen module exports.
 */
import { screen as title } from './title.js';
import { screen as questMap } from './quest-map.js';
import { screen as quest } from './quest.js';
import { screen as bossIntro } from './boss-intro.js';
import { screen as prebattle } from './prebattle.js';
import { screen as battle } from './battle.js';
import { screen as cards } from './cards.js';
import { screen as cardDetail } from './card-detail.js';
import { screen as collections } from './collections.js';
import { screen as arena } from './arena.js';
import { screen as league } from './league.js';
import { screen as shop } from './shop.js';
import { screen as boosterOpen } from './booster-open.js';
import { screen as character } from './character.js';
import { screen as help } from './help.js';
import { screen as lab } from './lab.js';

/** @type {Record<string, import('../router.js').Screen>} */
export const screens = {
  title,
  'quest-map': questMap,
  quest,
  'boss-intro': bossIntro,
  prebattle,
  battle,
  cards,
  'card-detail': cardDetail,
  collections,
  arena,
  league,
  shop,
  'booster-open': boosterOpen,
  character,
  help,
  lab,
};
