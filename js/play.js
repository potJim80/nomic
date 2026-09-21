// The phone: a controller for one player. Shows whatever the current phase asks of them.
import { joinRoom } from './net.js';
import { current, describe } from './game.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get: (k) => { try { return localStorage.getItem('nomic.' + k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('nomic.' + k, v); } catch {} } };

let me = store.get('id') || (Math.random().toString(36).slice(2, 10));
store.set('id', me);
let room = null, state = null, view = 'play', status = '', draft = { kind: 'enact', target: '', text: '' }, asking = false, seenRuling = null;

const params = new URLSearchParams(location.search);
const startCode = (params.get('code') || store.get('code') || '').toUpperCase();

function renderJoinForm(err) {
  $('#view').innerHTML = `
    <h1>Nomic</h1>
    <p>Type the code on the big screen.</p>
    <div><label>Room code</label><input id="code" class="code" maxlength="4" autocapitalize="characters" autocomplete="off" value="${esc(startCode)}"></div>
    <div><label>Your name</label><input id="name" maxlength="16" autocomplete="off" value="${esc(store.get('name') || '')}"></div>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}
    <button class="big" id="go">Sit down</button>`;
  $('#go').onclick = () => {
    const code = $('#code').value.trim().toUpperCase(), name = $('#name').value.trim();
    if (code.length !== 4) return renderJoinForm('The code is four letters.');
    if (!name) return renderJoinForm('You need a name at the table.');
    store.set('code', code); store.set('name', name);
    connect(code, name);
  };
}

function connect(code, name) {
  if (room) room.close();
  $('#view').innerHTML = `<h2>Finding the table…</h2><p>Code ${esc(code)}</p>`;
  room = joinRoom(code, {
    id: me, name,
    onState: (s) => { try { state = s; render(); } catch (e) { console.error('render failed', e); } },
    onStatus: (st) => {
      status = st;
      $('#status').textContent = { connecting: 'connecting', open: 'connected', closed: 'reconnecting…', error: 'connection error', 'no-room': 'no table with that code' }[st] || st;
      $('#status').className = 'status ' + (st === 'open' ? 'open' : '');
      if (st === 'no-room' && !state) renderJoinForm('No table is open with that code. Check the screen.');
    },
  });
}

function send(a) { room?.send(a); }

function render() {
  if (!state) return;
  const p = state.players.find(p => p.id === me);
  $('#me').textContent = p ? `${p.name} · ${p.score}` : 'Nomic';
  if (view === 'rules') return renderRules();
  if (view === 'table') return renderTable();
  const v = $('#view');
  const cur = current(state), mine = cur?.id === me;
  if (!p) { v.innerHTML = `<h2>The game has already begun.</h2><p>You can watch from here; ask the table to start a new game to join.</p>`; return; }

  switch (state.phase) {
    case 'lobby':
      v.innerHTML = `<h1>You're in.</h1><p>${state.players.length} at the table. ${state.players.length < 2 ? 'Waiting for one more.' : ''}</p>
        ${state.players[0].id === me ? `<button class="big" id="start" ${state.players.length < 2 ? 'disabled' : ''}>Start the game</button><p class="hint">You sat down first, so you start it. Play goes clockwise from you.</p>` : `<p class="hint">${esc(state.players[0].name)} starts the game.</p>`}`;
      $('#start') && ($('#start').onclick = () => send({ type: 'start' }));
      break;

    case 'propose':
      if (!mine) { v.innerHTML = `<h2>${esc(cur.name)} is writing a proposal.</h2><p>Proposal ${state.nextProposal}. Read the rules while you wait.</p>`; break; }
      renderProposeForm(v);
      break;

    case 'vote': {
      const pr = state.proposal;
      const done = pr.votes[me] !== undefined;
      v.innerHTML = `${paper(pr)}
        ${done ? `<h2>You voted ${pr.votes[me] ? 'aye' : 'nay'}.</h2><p>${Object.keys(pr.votes).length} of ${state.players.length} in.</p>`
               : `<p class="hint">${state.settings.unanimous || pr.kind === 'transmute' ? 'Needs every vote.' : 'Needs a majority.'} ${!state.settings.unanimous && pr.by !== me ? `Vote nay on a proposal that passes anyway and you gain ${state.settings.dissenterBonus} (rule 204).` : ''}</p>
                  <div class="vote"><button class="big aye" id="aye">Aye</button><button class="big nay" id="nay">Nay</button></div>`}`;
      $('#aye') && ($('#aye').onclick = () => send({ type: 'vote', yes: true }));
      $('#nay') && ($('#nay').onclick = () => send({ type: 'vote', yes: false }));
      break;
    }

    case 'result': {
      const pr = state.proposal;
      v.innerHTML = `${paper(pr)}<h1>${pr.adopted ? 'Adopted' : (pr.void ? 'Void' : 'Defeated')}${pr.void && !pr.yes && !pr.no ? '' : ` ${pr.yes}–${pr.no}`}</h1>
        <p>${pr.adopted ? `Rule ${pr.n} is now in effect.` : pr.void ? `Void: ${esc(pr.void)}. No penalty.` : pr.by === me ? `You lose ${state.settings.defeatPenalty} (rule 206).` : `${esc(cur.name)} loses ${state.settings.defeatPenalty}.`}</p>`;
      break;
    }

    case 'roll':
      v.innerHTML = mine ? `<h1>Your roll.</h1><p>One die, points to your score (rule 202).</p><button class="big" id="roll">Roll</button>`
                         : `<h2>${esc(cur.name)} is rolling.</h2>${state.lastRoll ? '' : ''}`;
      $('#roll') && ($('#roll').onclick = () => { $('#roll').disabled = true; send({ type: 'roll' }); });
      break;

    case 'over': {
      const w = state.players.find(p => p.id === state.winner);
      v.innerHTML = `<h1>${w ? (w.id === me ? 'You win.' : esc(w.name) + ' wins.') : 'Game over.'}</h1>${w ? `<div class="score">${w.score}</div>` : ''}<p>Rule 208. The table can start again from the screen.</p>`;
      break;
    }
  }
  if (state.phase !== 'lobby' && state.phase !== 'over') judgeBits(v);
}

function judgeBits(v) {
  if (!state.judge) return;
  const r = state.rulings[0];
  if (r && r.id !== seenRuling) {
    const q = state.requests.find(x => x.id === r.requestId);
    const b = document.createElement('div'); b.className = 'paper ruling';
    b.innerHTML = `<div class="n">Judgment${q ? ' · ' + esc(q.byName) + ' asked' : ''}</div>${q ? `<div class="kind">“${esc(q.text)}”</div>` : ''}<div class="text">${esc(r.text)}</div><button class="dismiss">Got it</button>`;
    b.querySelector('.dismiss').onclick = () => { seenRuling = r.id; render(); };
    v.prepend(b);
  }
  const mine = state.requests.filter(q => q.by === me && !q.answered).length;
  const d = document.createElement('div'); d.className = 'judgebox';
  if (!state.judge.present) d.innerHTML = `<p class="hint">⚖ The Judge's seat is empty right now.</p>`;
  else if (asking) {
    d.innerHTML = `<label>Your question for the Judge</label><textarea id="q" placeholder="What are you asking the Judge to settle?"></textarea><div class="row"><button class="big" id="ask">Invoke judgment</button><button class="big ghost" id="cancel">Never mind</button></div>`;
    d.querySelector('#ask').onclick = () => { const t = d.querySelector('#q').value.trim(); if (!t) return; send({ type: 'judgment', text: t }); asking = false; render(); };
    d.querySelector('#cancel').onclick = () => { asking = false; render(); };
  } else {
    d.innerHTML = `<button class="big ghost" id="invoke">⚖ Invoke judgment</button>${mine ? `<p class="hint">Your question is with the Judge.</p>` : ''}`;
    d.querySelector('#invoke').onclick = () => { asking = true; render(); };
  }
  v.appendChild(d);
}

function paper(pr) {
  const by = state.players.find(p => p.id === pr.by)?.name || '';
  return `<div class="paper"><div class="n">Proposal ${pr.n}</div><div class="kind">${esc(by)} moves to ${esc(describe(state, pr))}</div><div class="text">${esc(pr.text || (pr.kind === 'repeal' ? 'Strike the rule.' : 'Change its status.'))}</div></div>`;
}

function renderProposeForm(v) {
  const targets = state.rules.filter(r => draft.kind === 'transmute' ? true : r.mutable);
  const needsTarget = draft.kind !== 'enact', needsText = draft.kind === 'enact' || draft.kind === 'amend';
  v.innerHTML = `<h1>Your proposal.</h1><p>Number ${state.nextProposal}. Everyone votes once you send it.</p>
    <div class="kinds">${['enact', 'amend', 'repeal', 'transmute'].map(k => `<button data-k="${k}" class="${draft.kind === k ? 'on' : ''}">${{ enact: 'New rule', amend: 'Amend a rule', repeal: 'Repeal a rule', transmute: 'Transmute a rule' }[k]}</button>`).join('')}</div>
    ${needsTarget ? `<div><label>Which rule</label><select id="target"><option value="">—</option>${targets.map(r => `<option value="${r.n}" ${String(r.n) === String(draft.target) ? 'selected' : ''}>${r.n} ${r.mutable ? '' : '(immutable)'} — ${esc(r.text.slice(0, 50))}…</option>`).join('')}</select></div>` : ''}
    ${draft.kind === 'transmute' ? `<p class="note">Transmutation always needs a unanimous vote (rule 109).</p>` : ''}
    ${needsText ? `<div><label>${draft.kind === 'amend' ? 'New wording of the rule' : 'The rule'}</label><textarea id="text" placeholder="${draft.kind === 'amend' ? 'Write the whole rule as it should read.' : 'Write it the way you want it read back to you.'}">${esc(draft.text)}</textarea></div>` : ''}
    <button class="big" id="send">Put it to a vote</button>`;
  v.querySelectorAll('.kinds button').forEach(b => b.onclick = () => { draft.kind = b.dataset.k; renderProposeForm(v); });
  $('#target') && ($('#target').onchange = e => { draft.target = e.target.value; const r = state.rules.find(r => String(r.n) === draft.target); if (draft.kind === 'amend' && r && !draft.text) { draft.text = r.text; renderProposeForm(v); } });
  $('#text') && ($('#text').oninput = e => draft.text = e.target.value);
  $('#send').onclick = () => {
    if (needsTarget && !draft.target) return alert('Pick a rule.');
    if (needsText && !draft.text.trim()) return alert('Write the rule first.');
    send({ type: 'propose', kind: draft.kind, target: draft.target || null, text: draft.text });
    draft = { kind: 'enact', target: '', text: '' };
  };
}

function renderRules() {
  $('#view').innerHTML = `<h1>The rules</h1><p>${state.rules.length} in effect · ${state.settings.unanimous ? 'unanimity' : 'majority'} · first to ${state.settings.winScore}</p>
    <ol class="rules">${state.rules.map(r => `<li><b>${r.n}</b>${esc(r.text)}<small>${r.mutable ? 'mutable' : 'immutable'}</small></li>`).join('')}</ol>`;
}

function renderTable() {
  $('#view').innerHTML = `<h1>The table</h1><p>Code ${esc(state.code)} · turn ${state.turnNumber}</p>
    <ol class="players">${state.players.map((p, i) => `<li class="${i === state.turnIndex && state.phase !== 'lobby' ? 'cur' : ''}"><span>${esc(p.name)}${p.connected ? '' : ' (away)'}</span><span class="pts">${p.score}</span></li>`).join('')}</ol>
    ${state.judge ? `<h2>Rulings</h2><ol class="rules">${state.rulings.map(r => `<li>${esc(r.text)}<small>${esc(state.requests.find(q => q.id === r.requestId)?.byName || 'unprompted')}</small></li>`).join('') || '<li class="note">None yet.</li>'}</ol>` : ''}
    <h2>Past proposals</h2>
    <ol class="rules">${state.history.map(h => `<li><b>${h.n}</b>${esc(h.text || describe(state, h))}<small>${esc(h.byName)} · ${h.adopted ? 'adopted' : 'defeated'} ${h.yes}–${h.no}</small></li>`).join('') || '<li class="note">None yet.</li>'}</ol>
    ${state.players.find(p => p.id === me) && state.phase !== 'over' ? `<button class="big ghost danger" id="forfeit">Forfeit and leave the table</button><p class="hint">Rule 113. Your seat closes; play continues without you.</p>` : ''}`;
  $('#forfeit') && ($('#forfeit').onclick = () => { if (confirm('Leave the game for good?')) send({ type: 'forfeit' }); });
}

document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  view = b.dataset.v; render();
});

if (startCode && store.get('name') && params.has('code') === false && store.get('code') === startCode) connect(startCode, store.get('name'));
else renderJoinForm();
