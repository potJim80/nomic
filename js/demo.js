// ?demo — seats pretend players and plays turns on its own, so the screen can be judged offline.
import { current } from './game.js';

const NAMES = ['Ada', 'Bo', 'Cyrus', 'Dee', 'Emil'];
const PROPOSALS = [
  ['enact', 'Every player must end each proposal with a rhyme, or forfeit two points.'],
  ['enact', 'The player with the lowest score may, once per circuit, demand a re-vote.'],
  ['amend', 'The winner is the first player to achieve 60 (positive) points.', 208],
  ['enact', 'Proposals longer than 40 words are read aloud twice.'],
  ['repeal', '', 210],
  ['enact', 'A player who rolls a 1 gains 5 points instead.'],
  ['transmute', '', 116],
  ['enact', 'Any player may rename the die once per game; the die keeps the name.'],
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function runDemo(host) {
  for (let i = 0; i < NAMES.length; i++) { await sleep(700); await host.dispatch({ type: 'join', id: 'p' + i, name: NAMES[i] }); }
  await sleep(1500);
  await host.dispatch({ type: 'start' });
  let k = 0;
  while (host.state.phase !== 'over' && k < 40) {
    const s = host.state, me = current(s);
    await sleep(2500);
    const [kind, text, target] = PROPOSALS[k++ % PROPOSALS.length];
    await host.dispatch({ type: 'propose', id: me.id, kind, text, target });
    for (const p of [...host.state.players].sort(() => Math.random() - .5)) {
      await sleep(600 + Math.random() * 900);
      await host.dispatch({ type: 'vote', id: p.id, yes: p.id === me.id || Math.random() < .7 });
    }
    await sleep(800);
    await host.dispatch({ type: 'roll', id: me.id });
  }
}
