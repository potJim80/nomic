// The host: owns the state, applies actions in order, and paces the screen
// (holds the result on screen, plays the die before the score moves).
import { newGame, apply, advance, current } from './game.js';

export class Host {
  constructor({ render, showDie }) {
    this.render = render; this.showDie = showDie;
    const want = new URLSearchParams(location.search).get('code');   // ?code=ABCD pins the code (testing)
    this.state = newGame(want ? want.toUpperCase().slice(0, 4) : makeCode());
    this.queue = Promise.resolve();
    this.listeners = [];
    this.render(this.state);
  }
  onChange(fn) { this.listeners.push(fn); }
  set(s) { this.state = s; this.render(s); this.listeners.forEach(f => f(s)); }

  // Every action goes through here, one at a time, so pacing can't be interrupted.
  dispatch(action) {
    this.queue = this.queue.then(() => this.handle(action)).catch(e => console.error(e));
    return this.queue;
  }

  async handle(action) {
    const s = this.state;
    if (action.type === 'roll') {
      if (s.phase !== 'roll' || action.id !== current(s).id) return;
      const face = 1 + Math.floor(Math.random() * s.settings.dieSides);
      await this.showDie(face);
      this.set(apply(s, { ...action, face }));
      return;
    }
    const next = apply(s, action);
    if (next === s) return;
    this.set(next);
    if (next.phase === 'result') {
      await sleep(3600);
      this.set(advance(this.state));
    }
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Four letters, no vowels, so it never spells anything.
function makeCode() {
  const L = 'BCDFGHJKLMNPQRSTVWXZ';
  return Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join('');
}
