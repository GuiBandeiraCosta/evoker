'use strict';
/**
 * The first-session tutorial lines: who says them and the English text (exploration/research/round3/tutorial-v2.md). The
 * tutorial texts were server data in the original (tutorialmanagerv3 received them with each step), so they are not
 * in the APK's loca table: lines seen in the English client videos are verbatim; the lines only recorded in the
 * German 1.7.0 video are translated (marked "transl."). The quest map lines live in src/game/quests.js
 * (GUIDE_LINES, shown by the map's guide bubble) and are merged here.
 *
 * Speakers: the red-haired ranger guides (view_tutorialv3_text "characterGood", portrait bottom-left), the Worm
 * Shaman and the Succubus taunt ("characterBad", their own portraits); "box" is the text box without a speaker (the
 * fusion screen's second step).
 */
import { GUIDE_LINES } from '../../game/quests.js';

/** Portrait per speaker. */
export const SPEAKERS = Object.freeze({
  ranger: { name: 'Ranger', portrait: '/assets/ui/guide-ranger.jpg', side: 'good' },
  shaman: { name: 'Worm Shaman', portrait: '/assets/orig/ui/shaman_portrait.png', side: 'bad' },
  succubus: { name: 'Succubus', portrait: '/assets/cards/Succubus.jpg', side: 'bad' },
  box: { name: '', portrait: null, side: 'none' },
});

/** @typedef {{speaker: 'ranger'|'shaman'|'succubus'|'box', text: string}} TutorialLine */

const ranger = (text) => Object.freeze({ speaker: 'ranger', text });
const shaman = (text) => Object.freeze({ speaker: 'shaman', text });

/** Every line by id. */
export const LINES = Object.freeze({
  // quest map (also returned by quests.guideLine)
  follow: ranger(GUIDE_LINES.follow),
  afterHim: ranger(GUIDE_LINES.afterHim),
  tough: ranger(GUIDE_LINES.tough),
  rune: ranger(GUIDE_LINES.rune),
  toArena: ranger(GUIDE_LINES.toArena),
  arenaSouth: ranger(GUIDE_LINES.arenaSouth),
  finishClubSwinger: ranger(GUIDE_LINES.finishClubSwinger),
  // quest screen
  smite: ranger("The Shaman's orcs are in our way! Smite them!"),
  soulCard: ranger('One had a soul card! It will help fight our foe.'),
  noMoreRunning: shaman('No more running. This time I will either crush you or die trying!'),
  strangeTracks: ranger("Strange... these tracks aren't only from orcs!"), // transl.
  peasantWomen: ranger('Peasant women from the area claim that their husbands have disappeared.'), // transl.
  // pre-battle
  avenge: ranger('Avenge the village! Unleash your cards!'),
  looksDeadly: ranger('Looks deadly... arrange your cards with care.'),
  wrongOrder: shaman("Bah! You won't win with your cards in that order!"),
  uglyThing: ranger('What is that ugly thing?'),
  tribeAvenger: ranger("A Tribe Avenger! They're insane... just look..."), // transl.
  hidesCards: ranger('The opponent hides his cards.'), // transl.
  // fights and their rewards
  nextVictory: shaman('Your next victory will not come so easily, Evoker.'),
  shamanFled: ranger('The Shaman has fled! He dropped a soul card.'),
  didIt: ranger('You did it!'),
  mightyPiece: ranger('This card will be mighty once it is complete.'), // transl.
  demoness: ranger('Tell us why you burned down our town, demoness!'), // transl.
  wretchedVillage: Object.freeze({ speaker: 'succubus', text: 'That wretched little village? It is lost to you, Evoker!' }), // transl.
  // cards screen
  throatCutterStronger: ranger('Your Throat-Cutter is stronger than the Envoy.'),
  beatBoneBreaker: ranger("You'll beat the Shaman's Bone Breaker now!"),
  fuseGuide: ranger('Fuse identical cards to increase their power.'),
  fuseSecond: Object.freeze({ speaker: 'box', text: 'Now drag the other card onto the second slot.' }),
  trainGuide: ranger('Sacrifice weaker cards to train strong ones.'), // transl.
  // arena / pieces
  amateurMage: ranger('Defeat this amateur mage to get his card piece!'), // transl.
  stealPieces: ranger('Complete card pieces quickly, or other players might steal them.'), // transl.
});

/**
 * A line by id (null when unknown).
 * @param {string} id
 * @returns {TutorialLine|null}
 */
export function line(id) {
  return LINES[id] || null;
}
