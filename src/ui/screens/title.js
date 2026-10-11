'use strict';
/**
 * Title screen: the red dragon key art, the logo over the lower third, "Tap to continue".
 * First run plays the opening of the original client (src/ui/tutorial/opening.js: intro_part1 with the intro lore,
 * the scripted fight against the Worm Shaman, the burning tower of intro_part2), then creates the save with the
 * tutorial record and an automatic "user-<digits>" name (the name is asked on the first Arena visit,
 * comp_name_popup) and opens the quest map; a returning player lands on the Quest tab's landing feed.
 * The title is the first screen of every session, so it also installs the tutorial overlay (src/ui/tutorial).
 */
import { h, icon, keyActivate } from '../dom.js';
import { seedFromNow } from '../store.js';
import { installTutorial, newTutorialGame, runOpening } from '../tutorial/index.js';

const TAP_TO_CONTINUE = 'Tap to continue';

export const screen = {
  noChrome: true,
  /** @param {object} ctx */
  render(ctx) {
    installTutorial(ctx);
    let busy = false;
    const start = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!ctx.store.get()) {
          await runOpening(ctx, el);
          if (ctx.store.get()) { await ctx.replace('quest-map', { line: 'main' }); return; }
          const now = ctx.now();
          ctx.store.set(newTutorialGame(seedFromNow(now), now, ctx.deps));
          await ctx.replace('quest-map', { line: 'main' });
          return;
        }
        // a returning player lands on the Quest tab's feed, as the client's login did (ui.screens.landingpage);
        // the quest map itself opens without params, the feed needs { feed: true }
        await ctx.replace('quest-map', { feed: true });
      } finally {
        busy = false;
      }
    };
    const el = h('div.title-screen', { role: 'button', tabIndex: 0, 'aria-label': TAP_TO_CONTINUE, onClick: start, onKeydown: keyActivate(start) },
      h('div.title-art'),
      h('div.title-vignette'),
      h('div.title-tap', null, h('span', null, TAP_TO_CONTINUE), icon('tap-hand', { class: 'title-hand' })),
      h('div.title-version', null, 'Web recreation'));
    ctx.root.appendChild(el);
    setTimeout(() => { if (el.isConnected) el.focus({ preventScroll: true }); }, 50);
  },
};
