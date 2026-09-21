// The voice of the table: rulings (and, if wanted, the narration) read aloud on the screen.
// ElevenLabs when a key is set — the key lives in this browser's localStorage only — otherwise
// the browser's own speech. Press V on the screen to set it up.

const KEY = 'nomic.voice';
const DEFAULTS = { key: '', key2: '', voiceId: '', model: 'eleven_turbo_v2_5', read: 'rulings', rate: 1 };   // read: off | rulings | all; key2 is the fallback account
export const voice = { ...DEFAULTS };
try { Object.assign(voice, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
export function saveVoice(v) { Object.assign(voice, v); try { localStorage.setItem(KEY, JSON.stringify(voice)); } catch {} }

// One-time setup from a link: index.html?xi=KEY&voice=ID&read=all — saved, then scrubbed from the address bar.
{
  const q = new URLSearchParams(location.search);
  if (q.has('xi') || q.has('voice') || q.has('read')) {
    const v = {};
    if (q.has('xi')) v.key = q.get('xi');
    if (q.has('xi2')) v.key2 = q.get('xi2');
    if (q.has('voice')) v.voiceId = q.get('voice');
    if (q.has('read')) v.read = q.get('read');
    saveVoice(v);
    for (const k of ['xi', 'xi2', 'voice', 'read']) q.delete(k);
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  }
}

const queue = [];
let playing = false, unlocked = false;
document.addEventListener('pointerdown', () => unlocked = true, { once: true });
document.addEventListener('keydown', () => unlocked = true, { once: true });

export function say(text, { force = false } = {}) {
  if (voice.read === 'off' && !force) return;
  if (!text) return;
  queue.push(text);
  if (!playing) next();
}

async function next() {
  const text = queue.shift();
  if (text === undefined) { playing = false; return; }
  playing = true;
  try {
    if (voice.key && voice.voiceId) await eleven(text);
    else await browser(text);
  } catch (e) { console.warn('voice:', e.message); if (voice.key) { try { await browser(text); } catch {} } }
  next();
}

const cache = new Map();   // text -> object URL, so a repeated line costs no characters
// Primary key first; if it is out of characters (or refused), the fallback key takes over.
let exhausted = new Set();
async function eleven(text) {
  let url = cache.get(text);
  if (!url) {
    const keys = [voice.key, voice.key2].filter(k => k && !exhausted.has(k));
    if (!keys.length) { exhausted.clear(); throw new Error('every ElevenLabs key is exhausted or refused'); }
    let blob = null, lastErr = '';
    for (const key of keys) {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}?output_format=mp3_22050_32`, {
        method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: voice.model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      });
      if (r.ok) { blob = await r.blob(); break; }
      lastErr = `ElevenLabs ${r.status}: ${(await r.text()).slice(0, 120)}`;
      if ([401, 402, 429].includes(r.status)) { exhausted.add(key); continue; }   // quota or plan trouble → next key
      break;                                                                       // anything else is not the key's fault
    }
    if (!blob) throw new Error(lastErr);
    url = URL.createObjectURL(blob);
    if (cache.size > 50) cache.clear();
    cache.set(text, url);
  }
  await new Promise((res) => { const a = new Audio(url); a.playbackRate = voice.rate || 1; a.onended = res; a.onerror = res; a.play().catch(res); });
}

function browser(text) {
  return new Promise((res) => {
    if (!('speechSynthesis' in window)) return res();
    const u = new SpeechSynthesisUtterance(text); u.rate = voice.rate || 1;
    const en = speechSynthesis.getVoices().find(v => /en[-_]/.test(v.lang) && /Daniel|Samantha|Alex|Google UK English Male/.test(v.name));
    if (en) u.voice = en;
    u.onend = res; u.onerror = res; speechSynthesis.speak(u);
  });
}

// Narration lines from one state to the next. Rulings always (when on); the rest only in 'all'.
export function narrate(prev, s) {
  if (!prev || voice.read === 'off') return;
  const r = s.rulings[0];
  if (r && r.id !== prev.rulings[0]?.id) say(r.text);
  if (voice.read !== 'all') return;
  const name = (id) => s.players.find(p => p.id === id)?.name || 'someone';
  if (s.phase === 'propose' && prev.phase === 'lobby') say(`The game begins. ${name(s.players[0].id)} to propose.`);
  if (s.proposal && s.proposal.n !== prev.proposal?.n && s.phase === 'vote') {
    const p = s.proposal; const kind = { enact: 'a new rule', amend: `an amendment to rule ${p.target}`, repeal: `the repeal of rule ${p.target}`, transmute: `the transmutation of rule ${p.target}` }[p.kind];
    say(`Proposal ${p.n}. ${name(p.by)} moves ${kind}${p.text ? ': ' + p.text : ''}. The vote is open.`);
  }
  if (s.phase === 'result' && prev.phase === 'vote') {
    const p = s.proposal;
    say(p.adopted ? `Adopted, ${p.yes} to ${p.no}. Rule ${p.n} is in effect.` : p.void ? `Void. ${p.void}.` : `Defeated, ${p.yes} to ${p.no}. ${name(p.by)} loses ${s.settings.defeatPenalty}.`);
  }
  if (s.lastRoll !== prev.lastRoll && s.turnNumber !== prev.turnNumber && prev.phase === 'roll') say(`${name(prev.players[prev.turnIndex]?.id)} rolls a ${s.lastRoll}.`);
  if (s.phase === 'over' && prev.phase !== 'over') say(`${name(s.winner)} reaches ${s.settings.winScore}. The game is over.`);
  if (s.redo && !prev.redo) say(`${name(s.players[s.turnIndex].id)} may rewrite the proposal.`);
}

// Settings dialog (V on the screen).
export function openVoiceDialog() {
  let d = document.getElementById('voiceDialog');
  if (!d) {
    d = document.createElement('dialog'); d.id = 'voiceDialog';
    d.innerHTML = `<form method="dialog">
      <h3>Voice</h3>
      <label>Read aloud <select name="read"><option value="off">Nothing</option><option value="rulings">Rulings only</option><option value="all">Rulings and narration</option></select></label>
      <label>ElevenLabs API key <input name="key" type="password" autocomplete="off" placeholder="leave blank to use the Mac's own voice"></label>
      <label>Backup API key <input name="key2" type="password" autocomplete="off" placeholder="used when the first runs out of characters"></label>
      <label>Voice <select name="voiceId">
        <option value="JBFqnCBsd6RMkjVDRZzb">George — warm storyteller (British)</option>
        <option value="onwK4e9ZLuTAKqWW03F9">Daniel — steady broadcaster (British)</option>
        <option value="pqHfZKP75CvOlQylNhV4">Bill — wise, mature (American)</option>
        <option value="nPczCjzI2devNBz1zQrb">Brian — deep, comforting (American)</option>
        <option value="N2lVS1w4EtoT3dr4eOWO">Callum — husky trickster</option>
        <option value="pFZP5JQG7iQjIQuC4Bku">Lily — velvety (British)</option>
        <option value="XrExE9yKIg1WjnnlVkGX">Matilda — knowledgeable, professional</option>
        <option value="">Other (paste an ID below)</option>
      </select><input name="voiceIdOther" autocomplete="off" placeholder="voice ID — note: free plans can only use the built-in voices above"></label>
      <label>Model <select name="model"><option value="eleven_turbo_v2_5">Turbo v2.5 (fast, cheap)</option><option value="eleven_multilingual_v2">Multilingual v2 (best quality)</option><option value="eleven_flash_v2_5">Flash v2.5</option></select></label>
      <label>Speed <input name="rate" type="number" min="0.5" max="1.5" step="0.05"></label>
      <p class="hint">Stored only in this browser. Free ElevenLabs plans give about 10,000 characters a month — "rulings only" goes a long way; narration uses more.</p>
      <div class="row"><button value="test" type="button" id="voiceTest">Test</button><button value="ok">Save</button></div>
    </form>`;
    document.body.appendChild(d);
    d.querySelector('#voiceTest').onclick = () => { readForm(d); say('The Judge is listening.', { force: true }); };
    d.addEventListener('close', () => { if (d.returnValue === 'ok') readForm(d); });
  }
  const f = d.querySelector('form');
  for (const k of ['read', 'key', 'key2', 'model', 'rate']) f.elements[k].value = voice[k];
  const known = [...f.elements.voiceId.options].some(o => o.value === voice.voiceId);
  f.elements.voiceId.value = known ? voice.voiceId : '';
  f.elements.voiceIdOther.value = known ? '' : voice.voiceId;
  d.showModal();
}
function readForm(d) {
  const f = d.querySelector('form');
  saveVoice({ read: f.elements.read.value, key: f.elements.key.value.trim(), key2: f.elements.key2.value.trim(), voiceId: (f.elements.voiceId.value || f.elements.voiceIdOther.value).trim(), model: f.elements.model.value, rate: Number(f.elements.rate.value) || 1 });
  exhausted.clear();
}
