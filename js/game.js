// Game state and the mechanics the Initial Set makes explicit.
// Everything here is pure: apply(state, action) -> new state (or the same object if the action is ignored).
// The host runs it; screens render it.
import { INITIAL_SET } from './rules.js';

export const PHASES = ['lobby', 'propose', 'vote', 'result', 'roll', 'over'];

// Mechanics as numbers, so an adopted rule-change (or the Judge) can adjust them
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

// Enacted at the start of a game that has a Judge (Claude) at the table. Rule 211 lets a
// rule claim precedence explicitly, which is how this one sits beside 212.
export const JUDGE_RULE = { n: 214, mutable: true, text: "A Judge sits at the table who is not a player, holds no vote and scores no points. Any player may invoke Judgment at any time by putting a question to the Judge. The Judge settles the question in accordance with the rules then in effect and may, in settling it, award or deduct points, void a proposal, or set the magnitude of any number a rule names. The Judge's ruling may be overruled by a unanimous vote of the players taken before the next turn is begun. This rule takes precedence over rule 212." };

export function newGame(code, { judge = false } = {}) {
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
    judge: { name: 'Claude', present: !!judge },   // the Judge's seat (rule 214) — filled when Claude sits
    requests: [],           // judgment requests: { id, by, byName, text, at, answered }
    rulings: [],            // the Judge's rulings, newest first: { id, text, at, requestId }
    settings: { ...DEFAULT_SETTINGS },
    log: [],
  };
}

const COLORS = ['#e4b363', '#6fb3d2', '#d97b7b', '#8ac48a', '#c08ad8', '#e6a06a', '#7fd0c1', '#d8c07a'];

export function apply(state, action) {
  if (!action || typeof action.type !== 'string') return state;
  const s = structuredClone(state);
  const say = (t) => s.log.unshift({ t, at: Date.now() });
  switch (action.type) {

    case 'join': {
      if ((s.banned || []).includes(action.id)) return state;
      const back = s.players.find(p => p.id === action.id);
      if (back) { back.connected = true; return s; }
      if (s.phase !== 'lobby') return state;
      if (s.players.length >= 8) return state;
      const name = String(action.name || '').trim().slice(0, 16) || `Player ${s.players.length + 1}`;
      s.players.push({ id: action.id, name, score: 0, color: COLORS[s.players.length % COLORS.length], connected: true });
      say(`${name} sat down.`);
      return s;
    }

    case 'leave': {
      const p = s.players.find(p => p.id === action.id);
      if (!p) return state;
      p.connected = false;
      return s;
    }

    case 'start': {
      if (s.phase !== 'lobby' || s.players.length < 2) return state;
      s.phase = 'propose'; s.turnNumber = 1; s.turnIndex = 0;
      if (s.judge.present) seatJudge(s, say);
      say(`Game begins. ${s.players[0].name} to propose.`);
      return s;
    }

    // kind: 'enact' | 'amend' | 'repeal' | 'transmute'; target: rule number for the last three
    case 'propose': {
      if (s.phase !== 'propose' || action.id !== current(s).id) return state;
      const kind = ['enact', 'amend', 'repeal', 'transmute'].includes(action.kind) ? action.kind : 'enact';
      const text = String(action.text || '').trim().slice(0, 2000);
      if (!text && kind !== 'repeal' && kind !== 'transmute') return state;
      const target = kind === 'enact' ? null : Number(action.target);
      if (kind !== 'enact') {
        const r = s.rules.find(r => r.n === target);
        if (!r) return state;
        if (!r.mutable && kind !== 'transmute') return state;   // rule 103: immutable rules can't be amended/repealed
      }
      s.proposal = { n: s.nextProposal++, by: action.id, kind, text, target, votes: {} };
      delete s.redo;
      s.phase = 'vote';
      say(`Proposal ${s.proposal.n} by ${current(s).name}: ${describe(s, s.proposal)}.`);
      return s;
    }

    case 'vote': {
      if (s.phase !== 'vote' || !s.players.find(p => p.id === action.id)) return state;
      s.proposal.votes[action.id] = !!action.yes;   // a player may change their mind until the last vote is in
      return allVoted(s) ? resolve(s, say) : s;
    }

    case 'roll': {
      if (s.phase !== 'roll' || action.id !== current(s).id) return state;
      const sides = Math.max(1, s.settings.dieSides | 0);
      const face = Number.isInteger(action.face) && action.face >= 1 && action.face <= sides ? action.face : 1 + Math.floor(Math.random() * sides);
      current(s).score += face;
      s.lastRoll = face;
      say(`${current(s).name} rolled ${face}.`);
      return checkWin(s, say) || nextTurn(s, say);
    }

    // A player leaves the game for good (rule 113). Their seat closes; play continues around them.
    case 'forfeit': {
      const i = s.players.findIndex(p => p.id === action.id);
      if (i < 0) return state;
      const [gone] = s.players.splice(i, 1);
      say(`${gone.name} ${action.by === 'judge' ? 'was removed by the Judge' : 'forfeits'}.`);
      if (s.phase === 'lobby') { s.turnIndex = 0; return s; }
      if (s.phase === 'over') return s;
      if (s.players.length < 2) { s.winner = s.players[0]?.id || null; s.phase = 'over'; say(s.winner ? `${s.players[0].name} is the last at the table and wins.` : 'Nobody is left at the table.'); return s; }
      if (s.proposal?.votes) delete s.proposal.votes[gone.id];
      if (i === s.turnIndex) {
        // the mover left mid-turn: their proposal lapses, play passes on
        if (s.proposal && (s.phase === 'vote')) { s.history.unshift({ ...s.proposal, byName: gone.name, adopted: false, lapsed: true, yes: 0, no: 0 }); say(`Proposal ${s.proposal.n} lapses.`); }
        s.proposal = null;
        if (s.turnIndex >= s.players.length) { s.turnIndex = 0; endCircuit(s, say); }
        s.turnNumber++;
        s.phase = 'propose';
        delete s.pendingPhase;
        say(`${current(s).name} to propose.`);
        return s;
      }
      if (i < s.turnIndex) s.turnIndex--;
      if (s.phase === 'vote' && allVoted(s)) return resolve(s, say);
      return s;
    }

    // ---- the Judge's powers (rule 214) and the table's own corrections ----

    case 'setting': {
      if (!Object.hasOwn(s.settings, action.key)) return state;
      const v = typeof s.settings[action.key] === 'boolean' ? !!action.value : Number(action.value);
      if (typeof v === 'number' && !Number.isFinite(v)) return state;
      s.settings[action.key] = v;
      say(`${who(s, action)} sets ${action.key} to ${v}.`);
      return checkWin(s, say) || s;
    }

    case 'adjust': {   // points by hand
      const p = s.players.find(p => p.id === action.id || p.name.toLowerCase() === String(action.name || '').toLowerCase());
      const d = Number(action.delta);
      if (!p || !Number.isFinite(d) || d === 0) return state;
      p.score += d;
      say(`${p.name} ${d > 0 ? '+' : ''}${d}${action.reason ? ': ' + action.reason : ' by judgment.'}`);
      return checkWin(s, say) || s;
    }

    case 'judgment': {   // a player invokes Judgment
      if (!s.judge.present) return state;
      const p = s.players.find(p => p.id === action.id);
      const text = String(action.text || '').trim().slice(0, 500);
      if (!p || !text) return state;
      s.requests.push({ id: 'q' + (s.requests.length + 1), by: p.id, byName: p.name, text, at: Date.now(), answered: false, phase: s.phase, proposal: s.proposal?.n ?? null });
      say(`${p.name} invokes Judgment.`);
      return s;
    }

    case 'ruling': {     // the Judge answers
      const text = String(action.text || '').trim().slice(0, 1500);
      if (!text) return state;
      const req = s.requests.find(r => r.id === action.requestId);
      if (req) req.answered = true;
      s.rulings.unshift({ id: 'j' + (s.rulings.length + 1), text, at: Date.now(), requestId: req?.id || null });
      say(`Judgment: ${text.length > 80 ? text.slice(0, 77) + '…' : text}`);
      return s;
    }

    case 'void': {       // the Judge voids the proposal on the table
      if (!s.proposal || !['vote', 'result'].includes(s.phase)) return state;
      const p = s.proposal;
      p.adopted && undoAdoption(s, p);
      p.adopted = false; p.void = String(action.reason || 'judgment').slice(0, 300);
      p.yes = p.yes ?? 0; p.no = p.no ?? 0;
      if (s.phase === 'vote') {
        // voided before the vote closed: the mover gets to rewrite it. The number is spent (rule 108).
        s.history.unshift({ ...p, byName: current(s).name });
        s.proposal = null;
        s.redo = { n: p.n, reason: p.void };
        s.phase = 'propose';
        say(`Proposal ${p.n} is void: ${p.void}. ${current(s).name} may rewrite it.`);
      } else {
        const h = s.history.find(h => h.n === p.n); if (h) { h.adopted = false; h.void = p.void; }
        say(`Proposal ${p.n} is void: ${p.void}.`);
      }
      return s;
    }

    case 'strike': {     // the Judge removes a rule outright
      const i = s.rules.findIndex(r => r.n === Number(action.n));
      if (i < 0) return state;
      if (s.rules[i].mutable && s.rules.filter(r => r.mutable).length === 1) return state;   // rule 114
      const [r] = s.rules.splice(i, 1);
      say(`Rule ${r.n} struck${action.reason ? ': ' + action.reason : '.'}`);
      return s;
    }

    case 'ban': {        // the Judge removes a seat for good: it cannot rejoin this table
      const p = s.players.find(p => p.id === action.id || p.name.toLowerCase() === String(action.name || '').toLowerCase());
      if (!p) return state;
      s.banned = [...(s.banned || []), p.id];
      return apply(s, { type: 'forfeit', id: p.id, by: 'judge' });
    }

    case 'judge': {      // the Judge sits down or gets up
      const was = s.judge.present;
      s.judge.present = !!action.present;
      if (action.name) s.judge.name = String(action.name).slice(0, 16);
      if (s.judge.present && !was) { say(`${s.judge.name} takes the Judge's seat.`); if (s.phase !== 'lobby' && s.phase !== 'over') seatJudge(s, say); }
      if (!s.judge.present && was) say(`${s.judge.name} leaves the Judge's seat.`);
      return s;
    }

    case 'note': {       // a line in the log, nothing more
      say(String(action.text || '').slice(0, 200));
      return s;
    }

    case 'newgame': {    // same table, fresh rules and scores
      const next = newGame(s.code);
      next.players = s.players.map((p, i) => ({ ...p, score: 0, color: COLORS[i % COLORS.length] }));
      next.judge = { ...s.judge };
      next.banned = s.banned || [];
      next.log.unshift({ t: 'New game.', at: Date.now() });
      return next;
    }

    default: return state;
  }
}

// Rule 214 comes into effect when the Judge is seated — at the start, or mid-game if Claude sits down late.
function seatJudge(s, say) {
  if (s.rules.some(r => r.n === JUDGE_RULE.n || r.transmuted === JUDGE_RULE.n || r.amends === JUDGE_RULE.n)) return;
  s.rules.push({ ...JUDGE_RULE });
  say(`Rule 214 in effect: ${s.judge.name} is the Judge.`);
}

export function current(s) { return s.players[s.turnIndex]; }
export function allVoted(s) { return s.proposal && s.players.every(p => s.proposal.votes[p.id] !== undefined); }
export function needsUnanimity(s, p = s.proposal) { return s.settings.unanimous || p?.kind === 'transmute'; }

export function describe(s, p) {
  const t = p.target ? `rule ${p.target}` : '';
  return { enact: 'enact a new rule', amend: `amend ${t}`, repeal: `repeal ${t}`, transmute: `transmute ${t}` }[p.kind];
}

const who = (s, a) => a.by === 'judge' ? `The Judge` : 'The table';

// Rule 203 (unanimity / majority), 109 (transmutation is always unanimous), 204 (dissenter bonus),
// 206 (defeat penalty), 108 (numbering), 209 (mutable cap), 114 (there must be a mutable rule).
function resolve(s, say) {
  const p = s.proposal;
  const votes = Object.values(p.votes);
  const yes = votes.filter(Boolean).length;
  const adopted = needsUnanimity(s, p) ? yes === votes.length : yes > votes.length / 2;
  p.adopted = adopted; p.yes = yes; p.no = votes.length - yes;
  const mover = current(s);

  if (adopted) {
    const mutables = s.rules.filter(r => r.mutable).length;
    const r = p.kind === 'enact' ? null : s.rules.find(r => r.n === p.target);
    if (p.kind === 'enact' && mutables >= s.settings.maxMutable) { p.adopted = false; p.void = 'rule 209: too many mutable rules'; }
    else if (p.kind !== 'enact' && !r) { p.adopted = false; p.void = 'the rule no longer exists'; }
    else if ((p.kind === 'repeal' || (p.kind === 'transmute' && r.mutable)) && r.mutable && mutables === 1) { p.adopted = false; p.void = 'rule 114: there must always be a mutable rule'; }
    else if (p.kind === 'transmute' && !r.mutable && mutables >= s.settings.maxMutable) { p.adopted = false; p.void = 'rule 209: too many mutable rules'; }
    else {
      const i = s.rules.indexOf(r);
      if (p.kind === 'enact') s.rules.push({ n: p.n, mutable: true, text: p.text });
      if (p.kind === 'repeal') s.rules.splice(i, 1);
      if (p.kind === 'amend') s.rules[i] = { ...r, n: p.n, text: p.text, amends: r.n };
      if (p.kind === 'transmute') s.rules[i] = { ...r, n: p.n, mutable: !r.mutable, text: p.text || r.text, transmuted: r.n };
      p.was = r ? { ...r } : null;   // so the Judge can undo it
    }
    if (p.adopted && !s.settings.unanimous) {
      for (const pl of s.players) if (p.votes[pl.id] === false) pl.score += s.settings.dissenterBonus;
    }
    say(`Proposal ${p.n} ${p.adopted ? 'adopted' : 'void (' + p.void + ')'} ${yes}–${p.no}.`);
  } else {
    mover.score -= s.settings.defeatPenalty;
    say(`Proposal ${p.n} defeated ${yes}–${p.no}. ${mover.name} −${s.settings.defeatPenalty}.`);
  }
  s.history.unshift({ ...p, byName: mover.name });
  s.phase = 'result';
  s.pendingPhase = 'roll';
  return checkWin(s, say) || s;
}

function undoAdoption(s, p) {
  if (p.kind === 'enact') { const i = s.rules.findIndex(r => r.n === p.n); if (i >= 0) s.rules.splice(i, 1); }
  else if (p.was) {
    const i = s.rules.findIndex(r => r.n === p.n);
    if (i >= 0) s.rules[i] = { ...p.was }; else if (p.kind === 'repeal') { s.rules.push({ ...p.was }); s.rules.sort((a, b) => a.n - b.n); }
  }
  if (!s.settings.unanimous) for (const pl of s.players) if (p.votes[pl.id] === false) pl.score -= s.settings.dissenterBonus;
}

// Called by the host after the result has been shown long enough.
export function advance(state) {
  if (state.phase !== 'result') return state;
  const s = structuredClone(state);
  s.phase = s.pendingPhase || 'roll'; delete s.pendingPhase;
  return s;
}

function checkWin(s, say) {
  if (s.phase === 'lobby' || s.phase === 'over') return null;
  const w = s.players.find(p => p.score >= s.settings.winScore);
  if (!w) return null;
  s.winner = w.id; s.phase = 'over'; delete s.pendingPhase;
  say(`${w.name} reaches ${s.settings.winScore}. Game over.`);
  return s;
}

function endCircuit(s, say) {
  s.circuit++;
  if (s.settings.unanimous && s.circuit >= s.settings.circuitsUntilMajority) {
    s.settings.unanimous = false;
    say(`${s.circuit} circuits complete: rule 203 now requires only a simple majority.`);
  }
}

function nextTurn(s, say) {
  s.turnIndex = (s.turnIndex + 1) % s.players.length;
  s.turnNumber++;
  if (s.turnIndex === 0) endCircuit(s, say);
  s.proposal = null;
  s.phase = 'propose';
  say(`${current(s).name} to propose.`);
  return s;
}
