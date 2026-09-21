// Transport: a public MQTT broker over websockets. The screen and every phone connect to the
// broker; nothing connects to anything else, so it works from any network. The screen publishes
// the whole state (retained, so a phone that joins late gets it at once); phones publish actions.
//
// Brokers are public and unauthenticated: anyone who knows the four-letter code can read the
// table. That's the same as the code on the screen. Each phone carries a secret so nobody can
// act as another player.

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
const topic = (code, leaf) => `nomic/v1/${code.toUpperCase()}/${leaf}`;
const rid = () => Math.random().toString(36).slice(2, 10);
const parse = (buf) => { try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; } };
const opts = (extra = {}) => ({ clientId: 'nomic-' + rid(), clean: true, connectTimeout: 8000, reconnectPeriod: 2000, keepalive: 30, ...extra });

// Actions a phone may send. Everything else is the table's or the Judge's business.
const PLAYER_ACTIONS = new Set(['start', 'propose', 'vote', 'roll', 'forfeit', 'judgment']);

// The screen. Tries the brokers in order and uses the first that connects.
// judgeKey: shown on the screen; the Judge's commands must carry it.
export function hostRoom(code, { onAction, onLeave, judgeKey }) {
  const secrets = new Map();          // playerId -> secret from its first hello
  let client = null, lastState = null;
  const events = [];                  // connection log, for debugging from the console
  const ready = new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (i >= BROKERS.length) return reject(new Error('no-broker'));
      const url = BROKERS[i++];
      const c = mqtt.connect(url, opts({ reconnectPeriod: 0 }));
      const giveUp = setTimeout(() => { c.end(true); tryNext(); }, 9000);
      c.on('connect', () => {
        clearTimeout(giveUp);
        c.end(true);
        // reconnect for real, with auto-reconnect on
        client = mqtt.connect(url, opts());
        for (const ev of ['connect', 'reconnect', 'close', 'offline', 'error', 'disconnect']) client.on(ev, (e) => events.push(`${Date.now() % 100000} ${ev} ${e?.message || ''}`));
        client.on('connect', () => { client.subscribe(topic(code, 'host'), { qos: 1 }); if (lastState) publish(lastState); });
        client.on('message', (t, buf) => {
          const msg = parse(buf); if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'hello') {
            if (!secrets.has(msg.id)) secrets.set(msg.id, msg.secret);
            if (secrets.get(msg.id) !== msg.secret) return;
            onAction({ type: 'join', id: msg.id, name: msg.name });
            return;
          }
          if (msg.type === 'leave') { if (secrets.get(msg.id) === msg.secret) onLeave(msg.id); return; }
          if (msg.by === 'judge') {                              // the Judge's hand, keyed to this screen
            if (!judgeKey || msg.key !== judgeKey) return;
            const { key, ...action } = msg;
            onAction(action);
            return;
          }
          if (!PLAYER_ACTIONS.has(msg.type)) return;
          if (secrets.get(msg.id) !== msg.secret) return;   // a phone may only act as the player it introduced
          const { secret, by, ...action } = msg;
          onAction(action);
        });
        resolve(url);
      });
      c.on('error', () => { clearTimeout(giveUp); c.end(true); tryNext(); });
    };
    tryNext();
  });
  const publish = (state) => {
    lastState = state;
    events.push(`${Date.now() % 100000} publish ${client?.connected ? 'ok' : 'SKIPPED (not connected)'} phase=${state.phase}`);
    if (client?.connected) client.publish(topic(code, 'state'), JSON.stringify({ ...state, stamp: Date.now() }), { qos: 0, retain: true });
  };
  window.addEventListener('pagehide', () => { try { client?.publish(topic(code, 'state'), '', { retain: true }); } catch {} });
  return { ready, send: (_, state) => publish(state), broadcast: publish, peers: () => [...secrets.keys()], events };
}

// A phone. Listens on every broker for the room's state and settles on whichever has it.
export function joinRoom(code, { id, name, onState, onStatus }) {
  const secret = (() => { try { return localStorage.getItem('nomic.secret') || (localStorage.setItem('nomic.secret', rid()), localStorage.getItem('nomic.secret')); } catch { return rid(); } })();
  let chosen = null, closed = false, seen = 0;
  const clients = new Map();
  onStatus('connecting');
  const hello = () => chosen?.publish(topic(code, 'host'), JSON.stringify({ type: 'hello', id, name, secret }), { qos: 1 });

  for (const url of BROKERS) {
    const c = mqtt.connect(url, opts({ will: { topic: topic(code, 'host'), payload: JSON.stringify({ type: 'leave', id, secret }), qos: 1 } }));
    clients.set(url, c);
    c.on('connect', () => { if (!chosen) c.subscribe(topic(code, 'state'), { qos: 0 }); else if (c === chosen) { onStatus('open'); hello(); } });
    c.on('message', (t, buf) => {
      const s = parse(buf); if (!s || typeof s !== 'object' || !s.phase) return;
      if (s.stamp && Date.now() - s.stamp > 3 * 3600e3) return;      // a room someone left open hours ago
      if (!chosen) {
        chosen = c;
        for (const [u, other] of clients) if (other !== c) { other.end(true); clients.delete(u); }
        onStatus('open'); hello();
      }
      if (c !== chosen) return;
      seen++;
      onState(s);
    });
    c.on('reconnect', () => chosen === c && onStatus('closed'));
    c.on('error', (e) => onStatus('error', e.message));
    c.on('close', () => chosen === c && !closed && onStatus('closed'));
  }
  const noRoom = setTimeout(() => { if (!chosen && !closed) onStatus('no-room'); }, 7000);
  return {
    send(action) { if (chosen?.connected) chosen.publish(topic(code, 'host'), JSON.stringify({ ...action, id, secret }), { qos: 1 }); },
    close() { closed = true; clearTimeout(noRoom); try { chosen?.publish(topic(code, 'host'), JSON.stringify({ type: 'leave', id, secret }), { qos: 1 }); } catch {} for (const c of clients.values()) c.end(true); },
  };
}
