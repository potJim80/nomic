// Renders a game state onto the main screen. Pure view: render(state) any time state changes.
import { current, describe } from './game.js';
import { Host } from './host.js';
import { runDemo } from './demo.js';
import { hostRoom } from './net.js';
import { connectBridge } from './bridge.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let tab = 'immutable';
let prev = null;          // last rendered state, for change detection
let fx = { die: null, ruling: null };   // screen-only effects (a die mid-roll, a ruling being read out)
let lastRulingId = null;

export function render(s) {
  renderJoin(s);
  renderStatus(s);
  renderLog(s);
  renderRules(s);
  renderSeats(s);
  renderMarker(s);
  renderCenter(s);
  prev = s;
}

// Phones always join through the public page: when the screen runs off the local bridge
// (so Claude can judge), "localhost" would mean nothing to them.
const PUBLIC_PLAY_URL = 'https://potjim80.github.io/nomic/play.html';
function renderJoin(s) {
  $('code').textContent = s.code || '····';
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  $('joinUrl').textContent = local ? PUBLIC_PLAY_URL : location.origin + location.pathname.replace(/[^/]*$/, '') + 'play.html';
}

function renderStatus(s) {
  const t = $('turnLine');
  const c = current(s);
  t.textContent = {
    lobby: s.players.length < 2 ? 'Waiting for players' : `${s.players.length} at the table`,
    propose: `${c?.name} is proposing`,
    vote: `Voting on proposal ${s.proposal?.n}`,
    result: `Proposal ${s.proposal?.n} ${s.proposal?.adopted ? 'adopted' : 'defeated'}`,
    roll: `${c?.name} rolls`,
    over: 'Game over',
  }[s.phase] || '';
  const mut = s.rules.filter(r => r.mutable).length;
  $('rulesLine').textContent = `Turn ${s.turnNumber} · ${s.rules.length} rules (${mut} mutable) · ${s.settings.unanimous ? 'unanimity' : 'majority'} · first to ${s.settings.winScore}`;
  const j = $('judgeLine');
  if (!s.judge) j.hidden = true;
  else {
    j.hidden = false;
    const open = s.requests.filter(r => !r.answered).length;
    j.className = 'judgeline ' + (s.judge.present ? 'on' : '');
    j.textContent = s.judge.present ? `⚖ ${s.judge.name} is judging${open ? ` · ${open} question${open > 1 ? 's' : ''} waiting` : ''}` : `⚖ Judge's seat empty`;
  }
}

function renderLog(s) {
  const l = $('log');
  const want = s.log.slice(0, 14);
  if (l.dataset.top === String(want[0]?.at) && l.children.length === want.length) return;
  l.replaceChildren(...want.map(e => el('li', '', esc(e.t))));
  l.dataset.top = String(want[0]?.at);
}

function renderRules(s) {
  const list = s.rules.filter(r => r.mutable === (tab === 'mutable'));
  const ol = $('rules');
  const seen = new Set(prev?.rules.map(r => r.n));
  ol.replaceChildren(...list.map(r => {
    const li = el('li', prev && !seen.has(r.n) ? 'new' : '');
    li.innerHTML = `<b>${r.n}</b><span class="text">${esc(r.text)}</span>`;
    li.onclick = () => li.classList.toggle('open');
    return li;
  }));
}

// Seats sit on an ellipse around the felt; seat 0 at the bottom, then clockwise.
function seatPos(i, n) {
  const a = Math.PI / 2 + (2 * Math.PI * i) / n;
  return { x: 50 + 46 * Math.cos(a), y: 50 + 43 * Math.sin(a), a };
}

function renderSeats(s) {
  const box = $('seats');
  const n = s.players.length;
  const have = new Map([...box.children].map(c => [c.dataset.id, c]));
  s.players.forEach((p, i) => {
    let seat = have.get(p.id);
    if (!seat) {
      seat = el('div', 'seat');
      seat.dataset.id = p.id;
      seat.innerHTML = `<div class="body"><div class="token" style="--c:${p.color}">${esc(p.name[0].toUpperCase())}</div><div class="name"></div><div class="score">0</div></div><div class="card"><div class="back"></div><div class="face"></div></div>`;
      box.appendChild(seat);
    }
    have.delete(p.id);
    const { x, y, a } = seatPos(i, n);
    seat.style.left = x + '%'; seat.style.top = y + '%';
    seat.classList.toggle('current', s.phase !== 'lobby' && s.phase !== 'over' && i === s.turnIndex);
    seat.classList.toggle('away', !p.connected);
    seat.querySelector('.name').textContent = p.name;
    const sc = seat.querySelector('.score');
    if (sc.textContent !== String(p.score)) { sc.textContent = p.score; sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump'); }
    // vote card slides onto the felt in front of the seat
    const card = seat.querySelector('.card');
    const t = $('table').getBoundingClientRect();
    card.style.setProperty('--dx', ((0.35 - 0.46) * t.width * Math.cos(a)) + 'px');
    card.style.setProperty('--dy', ((0.28 - 0.43) * t.height * Math.sin(a)) + 'px');
    const v = s.proposal?.votes?.[p.id];
    const voted = v !== undefined && (s.phase === 'vote' || s.phase === 'result');
    card.classList.toggle('in', voted);
    card.classList.toggle('flip', voted && s.phase === 'result');
    card.classList.toggle('aye', v === true); card.classList.toggle('nay', v === false);
    card.querySelector('.face').textContent = v ? 'AYE' : 'NAY';
  });
  for (const gone of have.values()) gone.remove();
}

function renderMarker(s) {
  const m = $('marker');
  const on = s.phase !== 'lobby' && s.phase !== 'over' && s.players.length > 0;
  m.classList.toggle('on', on);
  if (!on) return;
  const { a } = seatPos(s.turnIndex, s.players.length);
  const t = $('table').getBoundingClientRect();
  const x = t.width / 2 + t.width * 0.30 * Math.cos(a), y = t.height / 2 + t.height * 0.20 * Math.sin(a);
  m.style.transform = `translate(${x - 9}px, ${y - 9}px)`;
}

function renderCenter(s) {
  const c = $('center');
  const newest = s.rulings[0];
  if (newest && newest.id !== lastRulingId) {
    lastRulingId = newest.id;
    if (prev) { fx.ruling = newest; clearTimeout(fx.rulingTimer); fx.rulingTimer = setTimeout(() => { fx.ruling = null; if (prev) render(prev); }, 12000); }
  }
  const key = fx.die ? 'die' : fx.ruling ? 'ruling:' + fx.ruling.id : `${s.phase}:${s.proposal?.n}:${s.winner}:${s.code}`;
  if (c.dataset.key === key) { if (s.phase === 'vote') updateTally(s); return; }
  c.dataset.key = key;
  c.replaceChildren();
  if (fx.die) { c.appendChild(dieEl(fx.die)); return; }
  if (fx.ruling) {
    const q = s.requests.find(r => r.id === fx.ruling.requestId);
    c.appendChild(el('div', 'paper ruling', `<div class="n">Judgment${q ? ` · asked by ${esc(q.byName)}` : ''}</div>${q ? `<div class="kind">“${esc(q.text)}”</div>` : ''}<div class="text">${esc(fx.ruling.text)}</div>`));
    return;
  }
  switch (s.phase) {
    case 'lobby':
      c.appendChild(el('div', 'waiting', `<div class="bigcode">${esc(s.code)}</div><small>${s.players.length < 2 ? 'two or more to begin' : 'press start on the host phone'}</small>`)); break;
    case 'propose':
      c.appendChild(el('div', 'waiting', `${esc(current(s).name)} is writing a proposal…<small>proposal ${s.nextProposal}</small>`)); break;
    case 'vote':
    case 'result': {
      const p = s.proposal;
      const paper = el('div', 'paper', `<div class="n">Proposal <b>${p.n}</b></div><div class="kind">${esc(current(s).name)} moves to ${esc(describe(s, p))}</div><div class="text">${esc(p.text || (p.kind === 'repeal' ? 'Strike the rule.' : 'Change its status.'))}</div><div class="tally"></div>`);
      if (s.phase === 'result') paper.appendChild(el('div', 'stamp ' + (p.adopted ? 'adopted' : 'defeated'), p.adopted ? 'Adopted' : (p.void ? 'Void' : 'Defeated')));
      c.appendChild(paper); updateTally(s); break;
    }
    case 'roll':
      c.appendChild(el('div', 'waiting', `${esc(current(s).name)} to roll<small>press roll on your phone</small>`)); break;
    case 'over': {
      const w = s.players.find(p => p.id === s.winner);
      c.appendChild(el('div', 'winner', `<div class="sub">Rule 208</div><div class="who">${esc(w?.name)}</div><div class="sub">wins with ${w?.score} · press N for a new game</div>`)); break;
    }
  }
}

function updateTally(s) {
  const t = $('center').querySelector('.tally'); if (!t) return;
  const p = s.proposal, n = Object.keys(p.votes).length;
  t.textContent = s.phase === 'result' ? `${p.yes} aye · ${p.no} nay · ${s.settings.unanimous || p.kind === 'transmute' ? 'unanimity required' : 'majority required'}`
    : `${n} of ${s.players.length} voted · ${s.settings.unanimous || p.kind === 'transmute' ? 'unanimity required' : 'majority required'}`;
}

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const LAND = { 1: 'rotateX(0) rotateY(0)', 2: 'rotateY(-90deg)', 3: 'rotateX(-90deg)', 4: 'rotateX(90deg)', 5: 'rotateY(90deg)', 6: 'rotateY(180deg)' };
function dieEl(face) {
  const w = el('div', 'die-wrap');
  const d = el('div', 'die rolling');
  for (let f = 1; f <= 6; f++) d.appendChild(el('div', 'f f' + f, Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[f].includes(i) ? 'on' : ''}"></i>`).join('')));
  w.append(d, el('div', 'die-label', ''));
  setTimeout(() => { d.classList.remove('rolling'); d.style.transform = LAND[face] + ' rotateZ(' + (Math.random() * 12 - 6) + 'deg)'; }, 1000);
  setTimeout(() => { w.querySelector('.die-label').textContent = face; }, 1900);
  return w;
}

// The screen asks for a die animation and gets a promise that resolves when it has landed.
export function showDie(face) {
  fx.die = face; if (prev) render(prev);
  return new Promise(res => setTimeout(() => { fx.die = null; res(); }, 2600));
}

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  tab = b.dataset.tab; if (prev) renderRules(prev);
});
window.addEventListener('resize', () => { if (prev) { renderSeats(prev); renderMarker(prev); } });

const host = new Host({ render, showDie });
window.nomic = host;
connectBridge(host);
if (new URLSearchParams(location.search).has('demo')) runDemo(host);
else if (window.Peer) openRoom();

function openRoom() {
  const room = hostRoom(host.state.code, {
    onAction: (a, conn) => host.dispatch(a).then(() => room.send(conn, host.state)),
    onLeave: (id) => host.dispatch({ type: 'leave', id }),
  });
  host.onChange(s => room.broadcast(s));
  window.nomicRoom = room;
  room.ready.then(() => drawQr(), (e) => { if (e.message === 'code-taken') location.reload(); });
}

function drawQr() {
  if (!window.qrcode) return;
  const url = $('joinUrl').textContent + '?code=' + host.state.code;
  const q = qrcode(0, 'M'); q.addData(url); q.make();
  $('qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// Keyboard on the host computer: Enter starts the game, N starts a new one after it ends.
window.addEventListener('keydown', e => {
  if (e.key === 'Enter' && host.state.phase === 'lobby') host.dispatch({ type: 'start' });
  if (e.key.toLowerCase() === 'n' && host.state.phase === 'over') host.dispatch({ type: 'newgame' });
});
