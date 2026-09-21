// The host: owns the state, applies actions in order, and paces the screen
// (holds the result on screen, plays the die before the score moves).
import { newGame, apply, advance, current } from './game.js';

export class Host {
  constructor({ render, showDie }) {
    this.render = render; this.showDie = showDie;
    const params = new URLSearchParams(location.search);
    const want = params.get('code');   // ?code=ABCD pins the code (testing)
    // A reload resumes the game in progress (same code, key, scores) unless ?new is given,
    // so the screen can be reloaded for new code mid-game without losing the table.
    const saved = !want && !params.has('new') && !params.has('resume') ? loadSaved() : null;
    const resume = params.get('resume');   // ?resume=CODE&key=KEY: pull the game back from the broker
    this.state = saved?.state || newGame((resume || want) ? (resume || want).toUpperCase().slice(0, 4) : makeCode());
    this.judgeKey = saved?.judgeKey || params.get('key') || makeCode(8);   // never in the state; only on this screen
    this.resumed = !!saved;
    this.wantsBrokerState = !!resume;
    this.queue = Promise.resolve();
    this.listeners = [];
    this.render(this.state);
  }
  onChange(fn) { this.listeners.push(fn); }
  set(s) { this.state = s; this.render(s); this.listeners.forEach(f => f(s)); this.save(); }
  save() { try { localStorage.setItem('nomic.host', JSON.stringify({ state: this.state, judgeKey: this.judgeKey, at: Date.now() })); } catch {} }

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

function loadSaved() {
  try {
    const d = JSON.parse(localStorage.getItem('nomic.host') || 'null');
    if (!d || Date.now() - d.at > 6 * 3600e3) return null;         // older than six hours: start fresh
    if (d.state.phase === 'over' || (d.state.phase === 'lobby' && d.state.players.length === 0)) return null;
    for (const p of d.state.players) p.connected = false;            // phones will say hello again
    return d;
  } catch { return null; }
}

// Consonants only, so it never spells anything.
function makeCode(n = 4) {
  const L = 'BCDFGHJKLMNPQRSTVWXZ';
  return Array.from({ length: n }, () => L[Math.floor(Math.random() * L.length)]).join('');
}
