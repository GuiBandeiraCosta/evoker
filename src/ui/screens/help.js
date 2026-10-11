'use strict';
/**
 * Help ("?") screen: the rules of game-design.md in plain words, one topic per screen, in a scrollable
 * carved panel with links to the other topics. The 1.7.4 client's "?" (and the profile's Support button) opened
 * the online Helpshift FAQ; this offline game shows these pages instead.
 */
import { h } from '../dom.js';
import { button } from '../components/buttons.js';
import { screenBody } from '../chrome.js';

/** @type {Record<string, {title: string, paragraphs: string[]}>} */
export const TOPICS = {
  'quest-map': {
    title: 'Quest map',
    paragraphs: [
      'The middle button of the bottom bar opens the quest map. The news board (your next daily reward, today\'s event, the open portal with its countdown, the booster shop and the next portal) greets you when you log in and stays one tap away: the Home button in the menu behind the orange arrow at the right of the bar.',
      'The map shows the 100 quests of the main quest line on the painted roads. Beaten quests carry small grey number badges, the golden rune circle marks your current quest and later quests are still locked. Beating a quest unlocks the next one; old quests can be replayed for more rewards.',
      'Portals are 25-quest lines with their own set of eight cards; one is open for seven days before the next one takes over. Tap the portal banner at the top of the main map to enter it (from player level 8). A closed portal cannot be entered until its turn comes round again: your progress and its tokens are kept, but its packs leave the shop until then.',
      'The ranger guide gives you hints while you learn the game. Tap her bubble to dismiss it.',
    ],
  },
  quest: {
    title: 'Quests',
    paragraphs: [
      'A quest is a series of 2 to 5 waves of minions. Tap a minion to defeat it: each tap costs stamina (2 on the first quest, rising to 7 on the last ones; portal quests cost more) and gives as much player XP. The purple bar shows your progress.',
      'Every tap pays the quest\'s gold (6 on quest 1, about 30 from quest 11); now and then a "Perfect!" tap pays about four and a half times as much. A cleared wave may drop a card of the quest\'s quality band.',
      'When your stamina is too low the Drink potion dialog appears: use a stamina potion to refill the bar, or buy one for 40 gems (20 on Drinking Contest days) and drink it right away. Stamina also regenerates one point per minute.',
      'When every wave is cleared the boss fight begins. Winning unlocks the next quest and rolls a boss reward: 45% gold, 25% a booster token, 15% a card piece, 10% a potion, 5% gems. The last quest of a portal pays 1,000 gold on top. Losing sends the minions back - the quest restarts at 0%.',
      'Leaving a quest keeps the minions you already beat, as long as you do not start another quest.',
    ],
  },
  battle: {
    title: 'Battle',
    paragraphs: [
      'Both players line up five cards. Your slot faces the opponent\'s slot with the same number. Fights last up to 20 rounds and resolve automatically; from the third quest\'s boss on you can skip to the result.',
      'Every round: suspension and stun effects fire first, then buffs (daze, strengthen, indestructible...), then every card attacks in slot order - your cards from left to right, then the opponent\'s. A card attacks if it is alive at the start of the phase, is not dazed and has attack above zero.',
      'Damage is split evenly between the card\'s attack directions (straight, diagonal left, diagonal right). A direction that hits an empty slot damages the enemy player instead. Diagonals that fall off the board do nothing.',
      'After the attacks: card heals, player heals, death triggers (abilities that fire when a card dies), then dead cards are removed - unless they revive. The fight ends when a player\'s health reaches zero, after round 20, or when nobody can deal damage any more. Higher health wins; a tie after round 20 is a draw.',
      'Tribe bonus: a line-up with cards of only one tribe (Dwarf, Elf or Orc) besides Neutrals, and more cards of that tribe than Neutrals, gives +20% player health.',
      'Rewards: every card in your line-up gains 10 + enemy deck mana / 2 XP (x1.5 on a win, x2 on Infinite Wisdom days). Arena, piece and league fights also give player XP (more against stronger rivals, four times as much on a win); quest bosses give none. Card and player level-ups are shown after the fight.',
    ],
  },
  cards: {
    title: 'Cards and deck',
    paragraphs: [
      'You can own up to 100 cards (card pieces do not count). Quest and fight card drops are sold for gold automatically when the collection is full; boosters, fusion and completed pieces may go over the limit.',
      'Every card has a tribe (Dwarf, Elf, Orc or Neutral), a rarity (Common to Ultimate), a mana cost, attack, health, attack directions and often an ability. Stats grow with the card\'s level; the level cap grows with the fusion stage.',
      'Deck slots: your deck starts with two open slots. Beating the boss of quest 2, 4 and 6 for the first time opens the third, fourth and fifth slot ("Card Slot Unlocked!"). Drag cards between the slots on the deck screen or before a fight. For Arena and League fights the deck\'s mana sum must not exceed your maximum mana.',
      'Tap a card for its detail page with the full stats, the ability text, the fusion pips and the Sell button. Cards in the active deck cannot be sold.',
    ],
  },
  training: {
    title: 'Card training',
    paragraphs: [
      'Unlocked when you beat quest 9 for the first time. Pick a card to train and up to 9 cards to sacrifice. Each sacrificed card gives 25 x mana x (level + 2) x rarity factor XP (Common 0.6, Standard 0.8, Uncommon 1, Rare 1.6, Heroic 2.4, Legendary 3.5, Ultimate 5). Trainer cards give 4,000 / 9,000 / 20,000 XP.',
      'Training costs gold for every sacrificed card, more for cards with a higher mana cost, level and rarity. Cards in the active deck cannot be sacrificed. Level-ups are shown with the old and new stats.',
    ],
  },
  fusion: {
    title: 'Fusion',
    paragraphs: [
      'Unlocked when you beat quest 3 for the first time. Fuse two copies of the same card at the same fusion stage into one card of the next stage (shown with "+" marks after the name and lit pips). The result starts at level 1 with a higher level cap and better stats.',
      'The fused card always starts with the full stats of its new stage (about 15% above the old stage\'s level 1), whatever the levels of the two cards you fused.',
      'Fusion costs gold by rarity and stage (Common: 200 / 800 / 1,800 / 3,200; Standard: 400 / 1,600 / 3,600 / 6,400).',
    ],
  },
  arena: {
    title: 'Arena',
    paragraphs: [
      'Unlocked when you beat quest 8 for the first time. Three opponents are offered, shown with their strongest card, level and health: green ones are easy, yellow ones are even and red ones are hard. The info button shows their best card, stats, quests and fights won; the swords attack.',
      'A fight costs mana equal to your deck\'s mana sum. You cannot fight with a deck whose mana sum exceeds your maximum mana. Rewards: gold (6 x enemy deck mana, doubled on a win), 10 Tournament Points per win, card XP and player XP. Once you play in the League, every Arena win also adds league points (more for red and higher-level rivals).',
      'New opponents are found after every fight and every 30 minutes. The Replays tab lists your last fights with the result, date and time; the eye button plays a fight again.',
    ],
  },
  pieces: {
    title: 'Card pieces',
    paragraphs: [
      'Boss fights can drop a piece of a set card. A piece starts a hunt in one of the 8 slots of the Pieces tab: the card is shown cut into puzzle pieces, outlined pieces are the ones you own and dark pieces are still missing.',
      'Another player holds each missing piece. The swords under a card show that player; beat them (for deck mana) to take the piece, a loss gives nothing. "Reroll opponent" finds another holder for 10 gems. A won hunt fight also adds league points (about 30, more against higher-level holders). When every piece is yours the card is created.',
      'Tap a card to see its pieces and complete it for gems. An empty slot gets you a random first piece for 100 gems (50 on Card-piece Day). Other players may raid one of your unfinished hunts each day - you are told on login. Raids can be switched off in the options.',
    ],
  },
  league: {
    title: 'League',
    paragraphs: [
      'Unlocked when you beat quest 10 for the first time. You start in the Bronze League. A league runs for one day (until midnight UTC, see the countdown) with about 50 players. Defeat other players to earn points: 150 per league win (300 on Double League Points days), plus 50 per Arena win and 25 per won piece hunt. Each opponent can be attacked up to 3 times per league.',
      'After each league the three players with the most points advance to the next league (Bronze, Silver, Gold); everybody else goes back to the Bronze League. Players with equal points share a rank.',
      'Prizes go down to rank 29 and grow with the league: in Bronze the winner gets a Rare card and 5 mana potions and ranks 20 to 29 get 25 gems; the Gold League pays Legendary cards to the top two. The info button lists every prize. League points also count as Tournament Points (1 per 10).',
    ],
  },
  shop: {
    title: 'Shop',
    paragraphs: [
      'The shop lists the Neophyte Pack, the open portal\'s two packs (with the time the offer ends), the next portal\'s two packs (coming soon, with the time until that portal opens), the Summoner\'s Pack and the Archmage\'s Pack. Tokens of a closed portal stay with you for its next turn.',
      'Each booster holds 9 face-down cards. Every card you draw costs 1 token of the pack, or gems per card when you have no token (Neophyte 50, Summoner 350, Archmage 975, portal packs 250 / 1,000). Draw as many as you like; the refresh button opens a new booster.',
      'Tap a pack or its "Look inside" button to open it on the 3 x 3 grid of face-down cards. The coloured squares under "May contain:" show the rarities the pack can hold. Portal packs mix in the open portal\'s own set cards; the big portal pack can hold its Ultimate card.',
      'Gems come from daily rewards, league prizes, boss drops, set collections and level-ups. The gem packs are shown for reference only: there is nothing to buy with real money.',
      'A daily event runs every day: Infinite Wisdom (double card XP), Drinking Contest (potions 20 gems), Card-piece Day, Double League Points, Great Potion Deal (3 potions for 60 gems), Get the Best Cards (boosters half price) or Golden Day (+50% gold).',
    ],
  },
  character: {
    title: 'Character',
    paragraphs: [
      'Tap the level, stamina and mana bar at the top to open your profile: your best card, your stats, quests, battles won and the size of your collection. Tap your portrait to change it and your name to rename yourself.',
      'Every player level gives 12 stat points, spent right away in the level-up dialog: 1 point = +30 maximum health, +1 maximum stamina or +1 maximum mana. Points you do not place yourself are shared out evenly when you tap Proceed. Points left over from older saves can be spent on the profile.',
      'Level-ups refill stamina and mana and pay a reward: 50 gold per level, plus gems, a stamina or mana potion or a Neophyte token in turn. New features open as you beat the main quests for the first time: Card Fusing after quest 3, the Arena after quest 8, Card Training after quest 9 and the League after quest 10 (games saved before the tutorial existed open them at levels 2, 4, 5 and 6).',
      'Player XP comes from minion taps (1 XP per stamina) and from Arena, piece and league fights. The XP needed for the next level grows slowly with the level; the maximum level is 200.',
      'Daily rewards: log in on consecutive days to walk through the reward calendar (potions, gems and booster tokens); it starts on the day after you begin. The rewards repeat every 21 days while your streak keeps counting. Missing a day starts the streak again at day 1.',
      'The orange arrow at the right of the bottom bar opens more buttons: the Album (card sets), your Profile, the Options (music and effects volume, battle speed, sound, simulated raids, reduced motion, export or import your save, reset) and Home (the news board).',
    ],
  },
  collections: {
    title: 'Collections',
    paragraphs: [
      'Each portal has a set of 8 cards and the main quest a set of 17. Owning every card of a set (at any fusion stage) grants a one-time gem reward: 4,000 to 5,600 gems for a portal set, 31,700 for the main set.',
      'Locked cards show as grey silhouettes with their rarity frame so you know what to hunt for.',
    ],
  },
};

/** The topics in the order of the "Other topics" list. */
const ORDER = ['quest-map', 'quest', 'battle', 'cards', 'training', 'fusion', 'arena', 'pieces', 'league', 'shop', 'character', 'collections'];

/**
 * Resolve any screen/topic id to a help topic id.
 * @param {string} id
 * @returns {string}
 */
export function topicFor(id) {
  if (TOPICS[id]) return id;
  const alias = { prebattle: 'battle', 'boss-intro': 'quest', 'card-detail': 'cards', 'booster-open': 'shop', title: 'quest-map', help: 'quest-map' };
  return alias[id] || 'quest-map';
}

export const screen = {
  /** @param {object} ctx */
  render(ctx) {
    const id = topicFor(ctx.params.topic || 'quest-map');
    const topic = TOPICS[id];
    ctx.chrome.mount({ back: true, help: id });
    const body = screenBody(ctx, 'help-body');
    body.append(
      h('h1.screen-title.orange', null, topic.title),
      h('div.help-panel.panel', null,
        h('div.help-text', null, topic.paragraphs.map((p) => h('p', null, p)))),
      h('div.help-topics', null,
        h('div.help-topics-title', null, 'Other topics'),
        h('div.help-topic-list', null, ORDER.filter((t) => t !== id).map((t) => button(TOPICS[t].title, { size: 'sm', onClick: () => ctx.replace('help', { topic: t }) })))));
  },
};
