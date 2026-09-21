// Game state and the mechanics the Initial Set makes explicit.
// Everything here is pure: apply(state, action) -> new state. The host runs it; screens render it.
import { INITIAL_SET } from './rules.js';

export const PHASES = ['lobby', 'propose', 'vote', 'result', 'roll', 'over'];

// Mechanics as numbers, so an adopted rule-change can adjust them from the host screen
// without touching code. Defaults are the Initial Set's.
export const DEFAULT_SETTINGS = {
  winScore: 100,          // rule 208
  unanimous: true,        // rule 203 — flips to majority after two full circuits
  circuitsUntilMajority: 2,
  dissenterBonus: 10,     // rule 204 — only once unanimity is gone
  defeatPenalty: 10,      // rule 206
  dieSides: 6,            // rule 202
  maxMutable: 25,         // rule 209
};

export function newGame(code) {
  return {
    code,
    phase: 'lobby',
    players: [],            // { id, name, score, color, connected }
    turnIndex: 0,
    circuit: 0,             // completed circuits of play
    turnNumber: 0,
    rules: INITIAL_SET.map(r => ({ ...r })),
    nextProposal: 301,      // rule 108
    proposal: null,         // { n, by, kind, text, target, votes: {id: bool} }
    history: [],            // past proposals with outcome
    lastRoll: null,
    winner: null,
    settings: { ...DEFAULT_SETTINGS },
    log: [],
  };
}

const COLORS = ['#e4b363', '#6fb3d2', '#d97b7b', '#8ac48a', '#c08ad8', '#e6a06a', '#7fd0c1', '#d8c07a'];

export function apply(state, action) {
  const s = structuredClone(state);
  const say = (t) => s.log.unshift({ t, at: Date.now() });
  switch (action.type) {

    case 'join': {
      if (s.players.find(p => p.id === action.id)) { s.players.find(p => p.id === action.id).connected = true; return s; }
      if (s.phase !== 'lobby') return s;
      const name = (action.name || '').trim().slice(0, 16) || `Player ${s.players.length + 1}`;
      s.players.push({ id: action.id, name, score: 0, color: COLORS[s.players.length % COLORS.length], connected: true });
      say(`${name} sat down.`);
      return s;
    }

    case 'leave': {
      const p = s.players.find(p => p.id === action.id);
      if (p) p.connected = false;
      return s;
    }

    case 'start': {
      if (s.phase !== 'lobby' || s.players.length < 2) return s;
      s.phase = 'propose'; s.turnNumber = 1; s.turnIndex = 0;
      say(`Game begins. ${s.players[0].name} to propose.`);
      return s;
    }

    // kind: 'enact' | 'amend' | 'repeal' | 'transmute'; target: rule number for the last three
    case 'propose': {
      if (s.phase !== 'propose' || action.id !== current(s).id) return s;
      const text = (action.text || '').trim();
      if (!text && action.kind !== 'repeal' && action.kind !== 'transmute') return s;
      const target = action.target ? Number(action.target) : null;
      if (action.kind !== 'enact') {
        const r = s.rules.find(r => r.n === target);
        if (!r) return s;
        if (!r.mutable && action.kind !== 'transmute') return s;   // rule 103: immutable rules can't be amended/repealed
      }
      s.proposal = { n: s.nextProposal++, by: action.id, kind: action.kind || 'enact', text, target, votes: {} };
      s.phase = 'vote';
      say(`Proposal ${s.proposal.n} by ${current(s).name}: ${describe(s, s.proposal)}`);
      return s;
    }

    case 'vote': {
      if (s.phase !== 'vote' || !s.players.find(p => p.id === action.id)) return s;
      s.proposal.votes[action.id] = !!action.yes;
      if (Object.keys(s.proposal.votes).length === s.players.length) return resolve(s, say);
      return s;
    }

    case 'roll': {
      if (s.phase !== 'roll' || action.id !== current(s).id) return s;
      const face = action.face || 1 + Math.floor(Math.random() * s.settings.dieSides);
      current(s).score += face;
      s.lastRoll = face;
      say(`${current(s).name} rolled ${face}.`);
      return checkWin(s, say) || nextTurn(s, say);
    }

    case 'setting': {
      if (action.key in s.settings) s.settings[action.key] = action.value;
      say(`Table set ${action.key} to ${action.value}.`);
      return s;
    }

    case 'adjust': {   // host correction: points by hand (rule 212: the table judges)
      const p = s.players.find(p => p.id === action.id);
      if (p) { p.score += action.delta; say(`${p.name} ${action.delta >= 0 ? '+' : ''}${action.delta} by judgment.`); }
      return checkWin(s, say) || s;
    }

    default: return s;
  }
}

export function current(s) { return s.players[s.turnIndex]; }

export function describe(s, p) {
  const t = p.target ? `rule ${p.target}` : '';
  return { enact: 'enact a new rule', amend: `amend ${t}`, repeal: `repeal ${t}`, transmute: `transmute ${t}` }[p.kind];
}

// Rule 203 (unanimity / majority), 109 (transmutation is always unanimous),
// 204 (dissenter bonus), 206 (defeat penalty), 108 (numbering), 209 (mutable cap).
function resolve(s, say) {
  const p = s.proposal;
  const votes = Object.values(p.votes);
  const yes = votes.filter(Boolean).length;
  const needUnanimous = s.settings.unanimous || p.kind === 'transmute';
  const adopted = needUnanimous ? yes === votes.length : yes > votes.length / 2;
  p.adopted = adopted; p.yes = yes; p.no = votes.length - yes;

  if (adopted) {
    if (p.kind === 'enact') {
      if (s.rules.filter(r => r.mutable).length >= s.settings.maxMutable) { p.adopted = false; p.void = 'rule 209'; }
      else s.rules.push({ n: p.n, mutable: true, text: p.text });
    } else {
      const r = s.rules.find(r => r.n === p.target);
      const i = s.rules.indexOf(r);
      if (p.kind === 'repeal') s.rules.splice(i, 1);
      if (p.kind === 'amend') s.rules[i] = { ...r, n: p.n, text: p.text, amends: r.n };
      if (p.kind === 'transmute') s.rules[i] = { ...r, n: p.n, mutable: !r.mutable, text: p.text || r.text, transmuted: r.n };
    }
    if (!s.settings.unanimous && p.adopted) {
      for (const pl of s.players) if (p.votes[pl.id] === false) pl.score += s.settings.dissenterBonus;
    }
    say(`Proposal ${p.n} ${p.adopted ? 'adopted' : 'void (' + p.void + ')'} ${yes}–${p.no}.`);
  } else {
    current(s).score -= s.settings.defeatPenalty;
    say(`Proposal ${p.n} defeated ${yes}–${p.no}. ${current(s).name} −${s.settings.defeatPenalty}.`);
  }
  s.history.unshift({ ...p, byName: current(s).name });
  s.phase = 'result';
  s.pendingPhase = 'roll';
  return s;
}

// Called by the host after the result has been shown long enough.
export function advance(state) {
  const s = structuredClone(state);
  if (s.phase === 'result') { s.phase = s.pendingPhase || 'roll'; delete s.pendingPhase; }
  return s;
}

function checkWin(s, say) {
  const w = s.players.find(p => p.score >= s.settings.winScore);
  if (!w) return null;
  s.winner = w.id; s.phase = 'over';
  say(`${w.name} reaches ${s.settings.winScore}. Game over.`);
  return s;
}

function nextTurn(s, say) {
  s.turnIndex = (s.turnIndex + 1) % s.players.length;
  s.turnNumber++;
  if (s.turnIndex === 0) {
    s.circuit++;
    if (s.settings.unanimous && s.circuit >= s.settings.circuitsUntilMajority) {
      s.settings.unanimous = false;
      say(`Two circuits complete: rule 203 now requires only a simple majority.`);
    }
  }
  s.proposal = null;
  s.phase = 'propose';
  say(`${current(s).name} to propose.`);
  return s;
}
