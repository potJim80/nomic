// PeerJS plumbing. The screen is the host peer, named after the room code; phones connect to it.
// Phones send actions ({type, ...}); the host replies with the whole state after every change.
// PeerJS's public introducer only helps the two browsers find each other; play is direct.

const ID_PREFIX = 'nomic-v1-';
const peerOpts = { debug: 1 };

export function hostRoom(code, { onAction, onLeave }) {
  const peer = new Peer(ID_PREFIX + code, peerOpts);
  const conns = new Map();          // peerId -> { conn, playerId }
  const ready = new Promise((res, rej) => {
    peer.on('open', () => res());
    peer.on('error', e => { if (e.type === 'unavailable-id') rej(new Error('code-taken')); else console.warn('peer error', e.type, e); });
  });
  peer.on('connection', conn => {
    conn.on('data', msg => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'hello') { conns.set(conn.peer, { conn, playerId: msg.id }); onAction({ type: 'join', id: msg.id, name: msg.name }, conn); return; }
      const c = conns.get(conn.peer);
      if (!c || msg.id !== c.playerId) return;     // a phone may only act as the player it introduced
      onAction(msg, conn);
    });
    conn.on('close', () => { const c = conns.get(conn.peer); conns.delete(conn.peer); if (c) onLeave(c.playerId); });
    conn.on('error', () => { const c = conns.get(conn.peer); conns.delete(conn.peer); if (c) onLeave(c.playerId); });
  });
  return {
    ready,
    send(conn, state) { if (conn.open) conn.send({ type: 'state', state }); },
    broadcast(state) { for (const { conn } of conns.values()) if (conn.open) conn.send({ type: 'state', state }); },
  };
}

export function joinRoom(code, { id, name, onState, onStatus }) {
  const peer = new Peer(peerOpts);
  let conn = null, closed = false;
  const connect = () => {
    onStatus('connecting');
    conn = peer.connect(ID_PREFIX + code.toUpperCase(), { reliable: true });
    conn.on('open', () => { onStatus('open'); conn.send({ type: 'hello', id, name }); });
    conn.on('data', msg => { if (msg?.type === 'state') onState(msg.state); });
    conn.on('close', () => { onStatus('closed'); if (!closed) setTimeout(connect, 2000); });
    conn.on('error', () => onStatus('error'));
  };
  peer.on('open', connect);
  peer.on('error', e => { onStatus(e.type === 'peer-unavailable' ? 'no-room' : 'error'); if (e.type === 'peer-unavailable' && !closed) setTimeout(connect, 3000); });
  return {
    send(action) { if (conn?.open) conn.send({ ...action, id }); },
    close() { closed = true; peer.destroy(); },
  };
}
