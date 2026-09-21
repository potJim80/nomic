"""Shared plumbing for judge.py and bot.py: find the room on the broker, read the state, send to the screen."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mqttws import MQTT

BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081']
HOME = os.path.expanduser('~/.config/nomic'); os.makedirs(HOME, exist_ok=True)
ROOM = os.path.join(HOME, 'room.json')

def load_room():
    try:
        with open(ROOM) as f: return json.load(f)
    except Exception: sys.exit('no room joined yet — run: judge.py join CODE KEY   (or bot.py join NAME --code CODE)')
def save_room(r):
    with open(ROOM, 'w') as f: json.dump(r, f)

def topic(code, leaf): return f'nomic/v1/{code.upper()}/{leaf}'

def find_room(code, timeout=6):
    """Which broker holds this room's retained state? Returns (broker_url, state) or (None, None)."""
    for url in BROKERS:
        try:
            c = MQTT(url).connect(); c.subscribe(topic(code, 'state'))
            for t, payload in c.messages(timeout=timeout / len(BROKERS) + 1):
                if payload:
                    s = json.loads(payload); c.close()
                    if s.get('phase'): return url, s
            c.close()
        except Exception: continue
    return None, None

def read_state(room, timeout=6):
    c = MQTT(room['broker']).connect(); c.subscribe(topic(room['code'], 'state'))
    for t, payload in c.messages(timeout=timeout):
        if payload: c.close(); return json.loads(payload)
    c.close(); sys.exit('no state on the broker — is the screen still open?')

def send(room, action, qos=1):
    c = MQTT(room['broker']).connect(); c.publish(topic(room['code'], 'host'), action, qos=qos); time.sleep(0.3); c.close()

def fingerprint(s):
    pr = s.get('proposal') or {}
    return (s['phase'], s['turnNumber'], len(s.get('requests', [])), s['nextProposal'], len(pr.get('votes', {})), len(s['players']),
            tuple(p['score'] for p in s['players']), len(s.get('rulings', [])), s.get('judge', {}).get('present'))

def watch(room, limit=600):
    """Block until the state changes (or limit seconds). Returns the new state, or None.
    Reconnects if the broker drops an idle connection."""
    first = None; t0 = time.time(); c = None
    while time.time() - t0 < limit:
        try:
            if c is None: c = MQTT(room['broker']).connect(); c.subscribe(topic(room['code'], 'state'))
            got = None
            for t, payload in c.messages(timeout=max(1, min(30, limit - (time.time() - t0)))):
                if payload: got = json.loads(payload); break
        except (ConnectionError, OSError):
            try: c.close()
            except Exception: pass
            c = None; time.sleep(2); continue
        if got is None: continue
        if first is None: first = fingerprint(got); continue
        if fingerprint(got) != first: c.close(); return got
    if c: c.close()
    return None

def current(s): return s['players'][s['turnIndex']] if s['players'] else None

def print_status(s, me=None):
    cur = current(s)
    j = s.get('judge') or {}
    print(f"phase: {s['phase']}   turn {s['turnNumber']}   circuit {s['circuit']}   {'unanimity' if s['settings']['unanimous'] else 'majority'}   first to {s['settings']['winScore']}   judge: {'seated' if j.get('present') else 'absent'}")
    for i, p in enumerate(s['players']):
        mark = '▶' if i == s['turnIndex'] and s['phase'] not in ('lobby', 'over') else ' '
        print(f"  {mark} {p['name']:<16} {p['score']:>5}{'' if p['connected'] else '  (away)'}{'  ← me' if me and p['id'] == me else ''}")
    pr = s.get('proposal')
    if pr:
        votes = pr.get('votes', {})
        print(f"proposal {pr['n']} by {cur['name'] if cur else '?'}: {pr['kind']}{' rule ' + str(pr['target']) if pr.get('target') else ''}")
        if pr.get('text'): print('  ' + pr['text'])
        if s['phase'] == 'vote':
            print(f"  votes in: {len(votes)}/{len(s['players'])}" + (f"   (mine: {'aye' if votes[me] else 'nay'})" if me in votes else ''))
        else: print(f"  {'ADOPTED' if pr.get('adopted') else 'VOID: ' + pr['void'] if pr.get('void') else 'DEFEATED'} {pr.get('yes', 0)}–{pr.get('no', 0)}")
    open_q = [q for q in s.get('requests', []) if not q['answered']]
    if open_q:
        print('OPEN QUESTIONS:')
        for q in open_q: print(f"  {q['id']} from {q['byName']} (during {q['phase']}{', proposal ' + str(q['proposal']) if q.get('proposal') else ''}): {q['text']}")
    if s.get('rulings'): print(f"last ruling: {s['rulings'][0]['text']}")
    if s['phase'] == 'over':
        w = next((p for p in s['players'] if p['id'] == s.get('winner')), None); print(f"WINNER: {w['name'] if w else '—'}")
    print('recent:'); [print('  ' + e['t']) for e in s['log'][:6]]
