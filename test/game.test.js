// node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, apply, advance, current, DEFAULT_SETTINGS, JUDGE_RULE } from '../js/game.js';
import { INITIAL_SET } from '../js/rules.js';

const NAMES = ['Ada', 'Bo', 'Cy', 'Dee', 'Emil'];
function table(n = 3, opts = {}) {
  let s = newGame('TEST', opts);
  for (let i = 0; i < n; i++) s = apply(s, { type: 'join', id: 'p' + i, name: NAMES[i] });
  return apply(s, { type: 'start' });
}
const ids = (s) => s.players.map(p => p.id);
const scores = (s) => s.players.map(p => p.score);
function voteAll(s, yesFor = () => true) { for (const p of s.players) s = apply(s, { type: 'vote', id: p.id, yes: yesFor(p) }); return s; }
function fullTurn(s, { text = 'A rule.', kind = 'enact', target, yes = () => true, face = 1 } = {}) {
  s = apply(s, { type: 'propose', id: current(s).id, kind, target, text });
  s = voteAll(s, yes);
  if (s.phase === 'over') return s;
  s = advance(s);
  return apply(s, { type: 'roll', id: current(s).id, face });
}

test('initial set is intact: 16 immutable, 13 mutable, numbered as Suber wrote them', () => {
  assert.equal(INITIAL_SET.filter(r => !r.mutable).map(r => r.n).join(','), Array.from({ length: 16 }, (_, i) => 101 + i).join(','));
  assert.equal(INITIAL_SET.filter(r => r.mutable).map(r => r.n).join(','), Array.from({ length: 13 }, (_, i) => 201 + i).join(','));
  const s = newGame('X');
  assert.equal(s.rules.length, 29); assert.equal(s.nextProposal, 301); assert.deepEqual(s.settings, DEFAULT_SETTINGS);
});

// ---------- lobby ----------
test('join: names trimmed to 16, blank names get a seat number, ids never duplicate, cap of 8', () => {
  let s = newGame('X');
  s = apply(s, { type: 'join', id: 'a', name: '  Alexandria the Great of Macedon ' });
  assert.equal(s.players[0].name, 'Alexandria the G');
  s = apply(s, { type: 'join', id: 'b', name: '   ' });
  assert.equal(s.players[1].name, 'Player 2');
  const before = s;
  s = apply(s, { type: 'join', id: 'a', name: 'Again' });
  assert.equal(s.players.length, 2); assert.equal(s.players[0].name, 'Alexandria the G');
  for (let i = 0; i < 10; i++) s = apply(s, { type: 'join', id: 'x' + i, name: 'X' + i });
  assert.equal(s.players.length, 8);
  assert.equal(apply(before, { type: 'join' }).players.length, 3, 'undefined id still seats (phones always send one)');
});

test('start needs two players and a lobby; nothing else moves in the lobby', () => {
  let s = newGame('X');
  s = apply(s, { type: 'join', id: 'a', name: 'A' });
  assert.equal(apply(s, { type: 'start' }), s);
  assert.equal(apply(s, { type: 'propose', id: 'a', text: 'x' }), s);
  assert.equal(apply(s, { type: 'vote', id: 'a', yes: true }), s);
  assert.equal(apply(s, { type: 'roll', id: 'a' }), s);
  s = apply(s, { type: 'join', id: 'b', name: 'B' });
  s = apply(s, { type: 'start' });
  assert.equal(s.phase, 'propose'); assert.equal(s.turnNumber, 1); assert.equal(current(s).id, 'a');
  assert.equal(apply(s, { type: 'start' }), s, 'cannot start twice');
});

test('nobody can join after the game starts, but a seated player can reconnect', () => {
  let s = table(2);
  assert.equal(apply(s, { type: 'join', id: 'late', name: 'Late' }), s);
  s = apply(s, { type: 'leave', id: 'p1' });
  assert.equal(s.players[1].connected, false);
  s = apply(s, { type: 'join', id: 'p1', name: 'whatever' });
  assert.equal(s.players[1].connected, true); assert.equal(s.players[1].name, 'Bo');
  assert.equal(apply(s, { type: 'leave', id: 'nobody' }), s);
});

test('garbage actions are ignored and never throw', () => {
  const s = table(3);
  for (const a of [null, undefined, {}, { type: 42 }, { type: 'nope' }, { type: 'vote' }, { type: 'propose', id: 'p0' }, { type: 'setting', key: '__proto__', value: 1 }, { type: 'adjust', id: 'p0', delta: 'lots' }, { type: 'setting', key: 'winScore', value: 'NaN' }])
    assert.equal(apply(s, a), s, JSON.stringify(a));
});

// ---------- proposing ----------
test('only the mover may propose, only in the propose phase, and only with text (unless repeal/transmute)', () => {
  let s = table(3);
  assert.equal(apply(s, { type: 'propose', id: 'p1', text: 'x' }), s);
  assert.equal(apply(s, { type: 'propose', id: 'p0', kind: 'enact', text: '   ' }), s);
  assert.equal(apply(s, { type: 'propose', id: 'p0', kind: 'amend', target: 201, text: '' }), s);
  const rep = apply(s, { type: 'propose', id: 'p0', kind: 'repeal', target: 201 });
  assert.equal(rep.phase, 'vote'); assert.equal(rep.proposal.n, 301); assert.equal(rep.nextProposal, 302);
  assert.equal(apply(rep, { type: 'propose', id: 'p0', text: 'again' }), rep, 'not during a vote');
});

test('rule 103: immutable rules cannot be amended or repealed, only transmuted; unknown targets rejected', () => {
  const s = table(3);
  assert.equal(apply(s, { type: 'propose', id: 'p0', kind: 'amend', target: 101, text: 'x' }), s);
  assert.equal(apply(s, { type: 'propose', id: 'p0', kind: 'repeal', target: 116 }), s);
  assert.equal(apply(s, { type: 'propose', id: 'p0', kind: 'repeal', target: 999 }), s);
  assert.equal(apply(s, { type: 'propose', id: 'p0', kind: 'amend', text: 'x' }), s, 'no target');
  assert.equal(apply(s, { type: 'propose', id: 'p0', kind: 'transmute', target: 116 }).phase, 'vote');
});

test('rule 108: every proposal takes the next number whether or not it passes; text capped at 2000', () => {
  let s = table(2);
  s = fullTurn(s, { text: 'one', yes: () => false });      // defeated → 301 used
  assert.equal(s.nextProposal, 302);
  s = fullTurn(s, { text: 'x'.repeat(5000) });
  assert.equal(s.history[0].n, 302); assert.equal(s.history[0].text.length, 2000);
  assert.equal(s.rules.find(r => r.n === 302).text.length, 2000);
});

// ---------- voting ----------
test('votes: non-players rejected, a player may change their mind until the last vote lands', () => {
  let s = table(3);
  s = apply(s, { type: 'propose', id: 'p0', text: 'r' });
  assert.equal(apply(s, { type: 'vote', id: 'ghost', yes: true }), s);
  s = apply(s, { type: 'vote', id: 'p0', yes: false });
  s = apply(s, { type: 'vote', id: 'p0', yes: true });
  assert.equal(s.proposal.votes.p0, true); assert.equal(s.phase, 'vote');
  s = apply(s, { type: 'vote', id: 'p1', yes: true });
  assert.equal(s.phase, 'vote');
  s = apply(s, { type: 'vote', id: 'p2', yes: true });
  assert.equal(s.phase, 'result'); assert.equal(s.proposal.adopted, true);
  assert.equal(apply(s, { type: 'vote', id: 'p2', yes: false }), s, 'no votes after the result');
});

test('rule 203 + 206: unanimity for the first two circuits; one nay defeats and costs the mover 10', () => {
  let s = table(3);
  s = apply(s, { type: 'propose', id: 'p0', text: 'r' });
  s = voteAll(s, p => p.id !== 'p2');
  assert.equal(s.proposal.adopted, false); assert.deepEqual(scores(s), [-10, 0, 0]);
  assert.equal(s.rules.length, 29, 'nothing enacted');
  assert.equal(s.history[0].yes, 2); assert.equal(s.history[0].no, 1);
});

test('rule 203 flips to majority after exactly two complete circuits, counted per table size', () => {
  for (const n of [2, 3, 5]) {
    let s = table(n);
    for (let t = 0; t < 2 * n - 1; t++) { s = fullTurn(s); assert.equal(s.settings.unanimous, true, `${n} players, turn ${t + 1}`); }
    s = fullTurn(s);
    assert.equal(s.settings.unanimous, false, `${n} players: majority after ${2 * n} turns`);
    assert.equal(s.circuit, 2); assert.equal(current(s).id, 'p0');
  }
});

test('majority: strictly more than half; a tie is defeated; transmutation still needs everyone (rule 109)', () => {
  let s = table(4);
  s.settings.unanimous = false;
  const tie = voteAll(apply(s, { type: 'propose', id: 'p0', text: 'r' }), p => ['p0', 'p1'].includes(p.id));
  assert.equal(tie.proposal.adopted, false);
  const win = voteAll(apply(s, { type: 'propose', id: 'p0', text: 'r' }), p => p.id !== 'p3');
  assert.equal(win.proposal.adopted, true);
  const tr = voteAll(apply(s, { type: 'propose', id: 'p0', kind: 'transmute', target: 116 }), p => p.id !== 'p3');
  assert.equal(tr.proposal.adopted, false, '3–1 is not enough to transmute');
  assert.equal(tr.rules.find(r => r.n === 116).mutable, false);
});

test('rule 204: dissenters on a winning proposal get 10 each, only once majority rule is in force', () => {
  let s = table(4);
  s.settings.unanimous = false;
  s = voteAll(apply(s, { type: 'propose', id: 'p0', text: 'r' }), p => p.id !== 'p3');
  assert.deepEqual(scores(s), [0, 0, 0, 10]);
  let u = table(4);   // still unanimous: a nay defeats, no bonus
  u = voteAll(apply(u, { type: 'propose', id: 'p0', text: 'r' }), p => p.id !== 'p3');
  assert.deepEqual(scores(u), [-10, 0, 0, 0]);
});

// ---------- what adoption does to the rulebook ----------
test('enact appends a mutable rule numbered by its proposal', () => {
  const s = voteAll(apply(table(2), { type: 'propose', id: 'p0', text: 'Hats.' }));
  const r = s.rules.at(-1);
  assert.deepEqual(r, { n: 301, mutable: true, text: 'Hats.' });
});

test('amend replaces the text in place and renumbers the rule (rule 108)', () => {
  const s = voteAll(apply(table(2), { type: 'propose', id: 'p0', kind: 'amend', target: 208, text: 'First to 50 wins.' }));
  const i = s.rules.findIndex(r => r.n === 301);
  assert.equal(s.rules.find(r => r.n === 208), undefined);
  assert.equal(s.rules[i].text, 'First to 50 wins.'); assert.equal(s.rules[i].amends, 208); assert.equal(s.rules[i].mutable, true);
  assert.equal(s.rules[i - 1].n, 207, 'stays in its place');
});

test('repeal removes the rule', () => {
  const s = voteAll(apply(table(2), { type: 'propose', id: 'p0', kind: 'repeal', target: 210 }));
  assert.equal(s.rules.length, 28); assert.equal(s.rules.find(r => r.n === 210), undefined);
});

test('transmute flips mutability, renumbers, keeps the text unless new text is given', () => {
  let s = voteAll(apply(table(2), { type: 'propose', id: 'p0', kind: 'transmute', target: 116 }));
  const r = s.rules.find(r => r.n === 301);
  assert.equal(r.mutable, true); assert.equal(r.transmuted, 116); assert.equal(r.text, INITIAL_SET.find(x => x.n === 116).text);
  s = advance(s); s = apply(s, { type: 'roll', id: 'p0', face: 1 });
  s = voteAll(apply(s, { type: 'propose', id: 'p1', kind: 'transmute', target: 201, text: 'Turns go widdershins.' }));
  const r2 = s.rules.find(r => r.n === 302);
  assert.equal(r2.mutable, false); assert.equal(r2.text, 'Turns go widdershins.');
  // once immutable, it can no longer be amended
  s = advance(s); s = apply(s, { type: 'roll', id: 'p1', face: 1 });
  assert.equal(apply(s, { type: 'propose', id: 'p0', kind: 'amend', target: 302, text: 'x' }), s);
});

test('rule 209: the 26th mutable rule is void even if the vote passes; the mover is not penalised', () => {
  let s = table(2);
  s.settings.maxMutable = 14;    // 13 mutable in the Initial Set
  s = fullTurn(s, { text: 'fourteen' });
  assert.equal(s.rules.filter(r => r.mutable).length, 14);
  s = apply(s, { type: 'propose', id: current(s).id, text: 'fifteen' });
  s = voteAll(s);
  assert.equal(s.proposal.adopted, false); assert.match(s.proposal.void, /209/);
  assert.equal(s.rules.filter(r => r.mutable).length, 14); assert.deepEqual(scores(s), [1, 0]);
});

test('rule 114: repealing or hardening the last mutable rule is void', () => {
  let s = table(2);
  s.rules = s.rules.filter(r => !r.mutable || r.n === 213);
  const rep = voteAll(apply(s, { type: 'propose', id: 'p0', kind: 'repeal', target: 213 }));
  assert.equal(rep.proposal.adopted, false); assert.match(rep.proposal.void, /114/); assert.equal(rep.rules.length, 17);
  const tr = voteAll(apply(s, { type: 'propose', id: 'p0', kind: 'transmute', target: 213 }));
  assert.equal(tr.proposal.adopted, false); assert.match(tr.proposal.void, /114/);
  const soften = voteAll(apply(s, { type: 'propose', id: 'p0', kind: 'transmute', target: 101 }));
  assert.equal(soften.proposal.adopted, true, 'making an immutable rule mutable is always fine');
});

// ---------- the roll and the turn ----------
test('roll: only the mover, only in the roll phase; face is bounded by dieSides; adds to score', () => {
  let s = voteAll(apply(table(3), { type: 'propose', id: 'p0', text: 'r' }));
  assert.equal(apply(s, { type: 'roll', id: 'p0', face: 6 }), s, 'not during the result');
  s = advance(s);
  assert.equal(s.phase, 'roll');
  assert.equal(apply(s, { type: 'roll', id: 'p1', face: 6 }), s);
  const r = apply(s, { type: 'roll', id: 'p0', face: 6 });
  assert.equal(r.players[0].score, 6); assert.equal(r.lastRoll, 6); assert.equal(r.phase, 'propose'); assert.equal(current(r).id, 'p1'); assert.equal(r.turnNumber, 2);
  for (let i = 0; i < 50; i++) { const x = apply(s, { type: 'roll', id: 'p0', face: 99 }).lastRoll; assert.ok(x >= 1 && x <= 6, 'out-of-range face is re-rolled'); }
  assert.ok(apply(s, { type: 'roll', id: 'p0', face: 0 }).lastRoll >= 1);
  s.settings.dieSides = 20;
  assert.equal(apply(s, { type: 'roll', id: 'p0', face: 20 }).lastRoll, 20);
});

test('advance only leaves the result phase', () => {
  const s = table(2);
  assert.equal(advance(s), s);
  const r = voteAll(apply(s, { type: 'propose', id: 'p0', text: 'r' }));
  assert.equal(advance(r).phase, 'roll'); assert.equal(advance(r).pendingPhase, undefined);
});

test('turn order goes round the table and back; turnNumber counts every turn', () => {
  let s = table(3);
  const order = [];
  for (let t = 0; t < 7; t++) { order.push(current(s).id); s = fullTurn(s); }
  assert.deepEqual(order, ['p0', 'p1', 'p2', 'p0', 'p1', 'p2', 'p0']);
  assert.equal(s.turnNumber, 8);
});

// ---------- winning ----------
test('rule 208: the first to reach winScore on a roll wins; game over freezes everything', () => {
  let s = table(2);
  s.players[0].score = 97;
  s = fullTurn(s, { face: 3 });
  assert.equal(s.phase, 'over'); assert.equal(s.winner, 'p0');
  for (const a of [{ type: 'propose', id: 'p0', text: 'x' }, { type: 'vote', id: 'p1', yes: true }, { type: 'roll', id: 'p1' }, { type: 'start' }, { type: 'join', id: 'z', name: 'Z' }])
    assert.equal(apply(s, a), s, a.type);
});

test('a win by dissenter bonus or adjustment ends the game too, and a lower winScore can end it at once', () => {
  let s = table(4);
  s.settings.unanimous = false; s.players[3].score = 95;
  s = voteAll(apply(s, { type: 'propose', id: 'p0', text: 'r' }), p => p.id !== 'p3');
  assert.equal(s.phase, 'over'); assert.equal(s.winner, 'p3');
  let t = table(2); t.players[1].score = 40;
  t = apply(t, { type: 'adjust', id: 'p1', delta: 60, reason: 'test' });
  assert.equal(t.phase, 'over');
  let u = table(2); u.players[0].score = 30;
  u = apply(u, { type: 'setting', key: 'winScore', value: 30 });
  assert.equal(u.phase, 'over'); assert.equal(u.winner, 'p0');
});

test('scores can go negative and the game carries on', () => {
  let s = table(2);
  for (let i = 0; i < 3; i++) s = fullTurn(s, { yes: () => false });
  assert.ok(scores(s).some(x => x < 0)); assert.equal(s.phase, 'propose');
});

// ---------- forfeits and dropouts ----------
test('forfeit in the lobby just empties the seat', () => {
  let s = newGame('X');
  s = apply(s, { type: 'join', id: 'a', name: 'A' }); s = apply(s, { type: 'join', id: 'b', name: 'B' });
  s = apply(s, { type: 'forfeit', id: 'a' });
  assert.deepEqual(ids(s), ['b']); assert.equal(s.phase, 'lobby');
  assert.equal(apply(s, { type: 'forfeit', id: 'zz' }), s);
});

test('forfeit by a player who is not the mover keeps the turn pointer on the same person', () => {
  let s = table(4);
  s = fullTurn(s);                       // now p1's turn
  s = apply(s, { type: 'forfeit', id: 'p0' });
  assert.deepEqual(ids(s), ['p1', 'p2', 'p3']); assert.equal(current(s).id, 'p1'); assert.equal(s.turnIndex, 0);
  s = apply(s, { type: 'forfeit', id: 'p3' });
  assert.equal(current(s).id, 'p1');
});

test('forfeit by the mover during a vote lapses the proposal and passes play on, no penalty', () => {
  let s = table(3);
  s = apply(s, { type: 'propose', id: 'p0', text: 'r' });
  s = apply(s, { type: 'vote', id: 'p1', yes: true });
  s = apply(s, { type: 'forfeit', id: 'p0' });
  assert.equal(s.phase, 'propose'); assert.equal(current(s).id, 'p1'); assert.equal(s.proposal, null);
  assert.equal(s.history[0].lapsed, true); assert.equal(s.rules.length, 29); assert.deepEqual(scores(s), [0, 0]);
  assert.equal(s.nextProposal, 302, 'the number is spent (rule 108)');
});

test('forfeit by the last player in the circuit closes the circuit', () => {
  let s = table(2);
  s = fullTurn(s);                       // p1's turn, circuit 0
  s = apply(s, { type: 'join', id: 'zz', name: 'no' });
  assert.equal(s.players.length, 2);
  let t = table(3); t = fullTurn(t); t = fullTurn(t);   // p2's turn
  t = apply(t, { type: 'forfeit', id: 'p2' });
  assert.equal(current(t).id, 'p0'); assert.equal(t.circuit, 1);
});

test('forfeit by the last holdout during a vote completes the vote', () => {
  let s = table(3);
  s = apply(s, { type: 'propose', id: 'p0', text: 'r' });
  s = apply(s, { type: 'vote', id: 'p0', yes: true }); s = apply(s, { type: 'vote', id: 'p1', yes: true });
  s = apply(s, { type: 'forfeit', id: 'p2' });
  assert.equal(s.phase, 'result'); assert.equal(s.proposal.adopted, true); assert.equal(s.proposal.yes, 2);
});

test('forfeit by the mover in the result or roll phase skips their roll', () => {
  let s = voteAll(apply(table(3), { type: 'propose', id: 'p0', text: 'r' }));
  const a = apply(s, { type: 'forfeit', id: 'p0' });
  assert.equal(a.phase, 'propose'); assert.equal(current(a).id, 'p1'); assert.equal(a.rules.length, 30, 'the adopted rule stands');
  assert.equal(advance(a), a, "the host's pending advance is now a no-op");
  const b = apply(advance(s), { type: 'forfeit', id: 'p0' });
  assert.equal(b.phase, 'propose'); assert.equal(current(b).id, 'p1');
});

test('when one player is left they win by default; a forfeit after game over changes nothing but the seats', () => {
  let s = table(2);
  s = apply(s, { type: 'forfeit', id: 'p0' });
  assert.equal(s.phase, 'over'); assert.equal(s.winner, 'p1');
  const t = apply(s, { type: 'forfeit', id: 'p1' });
  assert.equal(t.phase, 'over'); assert.equal(t.winner, 'p1');
});

// ---------- the Judge ----------
test('a game with a Judge enacts rule 214 at the start; without one, nothing changes', () => {
  const j = table(2, { judge: true });
  assert.deepEqual(j.rules.at(-1), JUDGE_RULE); assert.equal(j.rules.length, 30);
  assert.equal(table(2).rules.length, 29);
  assert.equal(apply(table(2), { type: 'judgment', id: 'p0', text: 'hey' }).requests.length, 0, 'no judge, no requests');
  // sitting down mid-game seats rule 214 once; getting up and sitting again does not duplicate it
  let s = table(2);
  s = apply(s, { type: 'judge', present: true });
  assert.equal(s.rules.filter(r => r.n === 214).length, 1);
  s = apply(s, { type: 'judge', present: false }); s = apply(s, { type: 'judge', present: true });
  assert.equal(s.rules.filter(r => r.n === 214).length, 1);
  assert.equal(apply(newGame('X'), { type: 'judge', present: true }).rules.length, 29, 'in the lobby it waits for the start');
});

test('judgment requests queue with context; rulings answer them; blanks are ignored', () => {
  let s = table(3, { judge: true });
  s = apply(s, { type: 'propose', id: 'p0', text: 'r' });
  assert.equal(apply(s, { type: 'judgment', id: 'p1', text: '   ' }), s);
  assert.equal(apply(s, { type: 'judgment', id: 'ghost', text: 'x' }), s);
  s = apply(s, { type: 'judgment', id: 'p1', text: 'Is this even a rule?' });
  const q = s.requests[0];
  assert.equal(q.id, 'q1'); assert.equal(q.byName, 'Bo'); assert.equal(q.phase, 'vote'); assert.equal(q.proposal, 301); assert.equal(q.answered, false);
  assert.equal(apply(s, { type: 'ruling', text: '' }), s);
  s = apply(s, { type: 'ruling', requestId: 'q1', text: 'It is. Vote.' });
  assert.equal(s.requests[0].answered, true); assert.equal(s.rulings[0].requestId, 'q1'); assert.equal(s.rulings[0].id, 'j1');
  s = apply(s, { type: 'ruling', text: 'Unprompted: play faster.' });
  assert.equal(s.rulings.length, 2); assert.equal(s.rulings[0].requestId, null);
  assert.equal(s.phase, 'vote', 'a ruling does not move the game');
});

test('adjust by id or by name (case-insensitive), with a reason in the log', () => {
  let s = table(2);
  s = apply(s, { type: 'adjust', name: 'bo', delta: -3, reason: 'rule 301' });
  assert.deepEqual(scores(s), [0, -3]); assert.match(s.log[0].t, /Bo -3: rule 301/);
  assert.equal(apply(s, { type: 'adjust', name: 'Nobody', delta: 1 }), s);
  assert.equal(apply(s, { type: 'adjust', id: 'p0', delta: 0 }), s);
});

test('setting: only known keys, numbers stay numbers, booleans stay booleans', () => {
  let s = table(2);
  s = apply(s, { type: 'setting', key: 'winScore', value: '60' });
  assert.equal(s.settings.winScore, 60);
  s = apply(s, { type: 'setting', key: 'unanimous', value: 0 });
  assert.equal(s.settings.unanimous, false);
  assert.equal(apply(s, { type: 'setting', key: 'bogus', value: 1 }), s);
  assert.equal(apply(s, { type: 'setting', key: 'dieSides', value: 'six' }), s);
});

test('void before the vote closes hands the turn back to the mover to rewrite: no penalty, number spent', () => {
  let s = table(3, { judge: true });
  s = apply(s, { type: 'propose', id: 'p0', text: 'Ada wins.' });
  s = apply(s, { type: 'vote', id: 'p1', yes: true });
  s = apply(s, { type: 'void', reason: 'rule 112' });
  assert.equal(s.phase, 'propose'); assert.equal(current(s).id, 'p0'); assert.equal(s.proposal, null);
  assert.deepEqual(s.redo, { n: 301, reason: 'rule 112' });
  assert.equal(s.history[0].n, 301); assert.equal(s.history[0].void, 'rule 112');
  assert.deepEqual(scores(s), [0, 0, 0]);
  assert.equal(apply(s, { type: 'roll', id: 'p0' }), s, 'no roll until a proposal has been voted on');
  s = apply(s, { type: 'propose', id: 'p0', text: 'Ada gets a point.' });
  assert.equal(s.proposal.n, 302); assert.equal(s.redo, undefined);
  s = voteAll(s); s = advance(s); s = apply(s, { type: 'roll', id: 'p0', face: 2 });
  assert.equal(s.phase, 'propose'); assert.equal(current(s).id, 'p1'); assert.equal(s.nextProposal, 303);
});

test('void right after adoption undoes the enactment, amendment, repeal or transmutation and any dissenter bonus', () => {
  let base = table(4, { judge: true }); base.settings.unanimous = false;
  const cases = [
    { kind: 'enact', text: 'x', check: s => assert.equal(s.rules.find(r => r.n === 301), undefined) },
    { kind: 'amend', target: 208, text: 'y', check: s => assert.equal(s.rules.find(r => r.n === 208).text, INITIAL_SET.find(r => r.n === 208).text) },
    { kind: 'repeal', target: 210, check: s => assert.ok(s.rules.find(r => r.n === 210)) },
    { kind: 'transmute', target: 116, check: s => assert.equal(s.rules.find(r => r.n === 116).mutable, false) },
  ];
  for (const c of cases) {
    let s = voteAll(apply(base, { type: 'propose', id: 'p0', kind: c.kind, target: c.target, text: c.text }), p => c.kind === 'transmute' || p.id !== 'p3');
    assert.equal(s.proposal.adopted, true, c.kind);
    s = apply(s, { type: 'void', reason: 'ambiguous' });
    assert.equal(s.proposal.adopted, false); assert.equal(s.history[0].adopted, false);
    c.check(s);
    assert.deepEqual(scores(s), [0, 0, 0, 0], c.kind + ': bonus undone');
    assert.equal(s.rules.length, 30, c.kind + ': rulebook back to 29 + rule 214');
  }
  assert.equal(apply(base, { type: 'void' }), base, 'nothing to void in the propose phase');
});

test('strike removes a rule, but never the last mutable one (rule 114)', () => {
  let s = table(2, { judge: true });
  s = apply(s, { type: 'strike', n: 210, reason: 'unenforceable online' });
  assert.equal(s.rules.find(r => r.n === 210), undefined);
  assert.equal(apply(s, { type: 'strike', n: 999 }), s);
  s.rules = s.rules.filter(r => !r.mutable || r.n === 213);
  assert.equal(apply(s, { type: 'strike', n: 213 }), s);
  assert.equal(apply(s, { type: 'strike', n: 101 }).rules.find(r => r.n === 101), undefined, 'immutable rules can be struck by judgment');
});

test('ban removes the seat and keeps that phone out, even after a new game', () => {
  let s = newGame('X');
  s = apply(s, { type: 'join', id: 'a', name: 'A' }); s = apply(s, { type: 'join', id: 'b', name: 'Rude' });
  s = apply(s, { type: 'ban', name: 'rude' });
  assert.deepEqual(ids(s), ['a']);
  assert.equal(apply(s, { type: 'join', id: 'b', name: 'Rude' }), s);
  s = apply(s, { type: 'join', id: 'c', name: 'C' }); s = apply(s, { type: 'start' });
  assert.equal(apply(s, { type: 'ban', name: 'nobody' }), s);
  s = apply(s, { type: 'ban', name: 'C' });
  assert.equal(s.phase, 'over', 'one player left');
  s = apply(s, { type: 'newgame' });
  assert.equal(apply(s, { type: 'join', id: 'b', name: 'Rude' }), s);
});

test('newgame keeps the seats and the code, resets everything else — rules, numbers, die, win score', () => {
  let s = table(3, { judge: true });
  s = fullTurn(s, { text: 'r' });
  s = apply(s, { type: 'setting', key: 'dieSides', value: 50, by: 'judge' });
  s = apply(s, { type: 'setting', key: 'winScore', value: 40, by: 'judge' });
  s = apply(s, { type: 'strike', n: 210, by: 'judge' });
  assert.equal(s.settings.dieSides, 50);
  s = apply(s, { type: 'judge', present: true });
  s = apply(s, { type: 'newgame' });
  assert.equal(s.phase, 'lobby'); assert.equal(s.code, 'TEST'); assert.deepEqual(ids(s), ['p0', 'p1', 'p2']); assert.deepEqual(scores(s), [0, 0, 0]);
  assert.equal(s.rules.length, 29); assert.equal(s.nextProposal, 301); assert.equal(s.judge.present, true); assert.equal(s.history.length, 0);
  assert.deepEqual(s.settings, DEFAULT_SETTINGS, 'six-sided die, first to 100, unanimity: every game starts from the Initial Set');
  assert.deepEqual(s.rules.map(r => r.n), INITIAL_SET.map(r => r.n));
  assert.equal(s.rulings.length, 0); assert.equal(s.requests.length, 0);
  s = apply(s, { type: 'start' });
  assert.equal(s.rules.length, 30);
});

test('a long game: 5 players, random votes and rolls, invariants hold every step', () => {
  let s = table(5, { judge: true });
  let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  let steps = 0;
  while (s.phase !== 'over' && steps++ < 2000) {
    const me = current(s);
    const kinds = ['enact', 'enact', 'amend', 'repeal', 'transmute'];
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const pool = s.rules.filter(r => kind === 'transmute' ? true : r.mutable);
    const target = pool[Math.floor(rnd() * pool.length)]?.n;
    let n = apply(s, { type: 'propose', id: me.id, kind, target, text: 'rule ' + steps });
    if (n === s) { n = apply(s, { type: 'propose', id: me.id, kind: 'enact', text: 'rule ' + steps }); }
    s = n;
    assert.equal(s.phase, 'vote');
    s = voteAll(s, () => rnd() < 0.75);
    assert.ok(['result', 'over'].includes(s.phase));
    if (s.phase === 'over') break;
    assert.ok(s.rules.filter(r => r.mutable).length >= 1, 'rule 114');
    assert.ok(s.rules.filter(r => r.mutable).length <= s.settings.maxMutable, 'rule 209');
    assert.equal(new Set(s.rules.map(r => r.n)).size, s.rules.length, 'rule numbers unique');
    s = advance(s);
    s = apply(s, { type: 'roll', id: me.id, face: 1 + Math.floor(rnd() * 6) });
  }
  assert.equal(s.phase, 'over'); assert.ok(s.players.find(p => p.id === s.winner).score >= 100);
  assert.ok(s.history.length > 20);
  assert.equal(s.history[0].n, s.nextProposal - 1);
});
