#!/usr/bin/env python3
"""The Judge's hand. Claude Code runs these; the screen applies them.

  judge.py status                       the table at a glance + open questions
  judge.py rules                        every rule in effect
  judge.py history                      past proposals
  judge.py wait [seconds]               block until something new happens (a question, a vote, a turn)
  judge.py sit | leave                  take / leave the Judge's seat
  judge.py rule "text" [--for q3]       deliver a ruling (optionally answering question q3)
  judge.py adjust NAME DELTA "reason"   points by judgment
  judge.py set KEY VALUE                winScore unanimous dissenterBonus defeatPenalty dieSides maxMutable circuitsUntilMajority
  judge.py void "reason"                void the proposal on the table (during the vote or right after)
  judge.py strike N "reason"            remove rule N outright
  judge.py remove NAME                  remove a player from the table (rule 113)
  judge.py newgame                      same seats, fresh rules
"""
import json, sys, time, urllib.request

BRIDGE = 'http://localhost:8787'

def get(path):
    with urllib.request.urlopen(BRIDGE + path, timeout=5) as r: return json.load(r)
def post(path, data):
    req = urllib.request.Request(BRIDGE + path, data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=5) as r: return json.load(r)
def send(action):
    action['by'] = 'judge'
    r = post('/bridge/command', action); print(f"sent #{r['seq']}: {action['type']}")

def state():
    s = get('/bridge/state')['state']
    if not s: sys.exit('no state yet — is the screen open at http://localhost:8787/ ?')
    return s

def current(s): return s['players'][s['turnIndex']] if s['players'] else None

def status(s):
    cur = current(s)
    print(f"phase: {s['phase']}   turn {s['turnNumber']}   circuit {s['circuit']}   {'unanimity' if s['settings']['unanimous'] else 'majority'}   first to {s['settings']['winScore']}   judge: {'seated' if s.get('judge', {}) and s['judge'].get('present') else 'absent'}")
    for i, p in enumerate(s['players']):
        print(f"  {'▶' if i == s['turnIndex'] and s['phase'] not in ('lobby', 'over') else ' '} {p['name']:<16} {p['score']:>5}{'' if p['connected'] else '  (away)'}")
    pr = s.get('proposal')
    if pr:
        votes = pr.get('votes', {})
        print(f"proposal {pr['n']} by {cur['name'] if cur else '?'}: {pr['kind']}{' rule ' + str(pr['target']) if pr.get('target') else ''}")
        if pr.get('text'): print('  ' + pr['text'])
        if s['phase'] == 'vote': print(f"  votes in: {len(votes)}/{len(s['players'])}")
        else: print(f"  {'ADOPTED' if pr.get('adopted') else 'VOID: ' + pr['void'] if pr.get('void') else 'DEFEATED'} {pr.get('yes', 0)}–{pr.get('no', 0)}")
    open_q = [q for q in s.get('requests', []) if not q['answered']]
    if open_q:
        print('OPEN QUESTIONS:')
        for q in open_q: print(f"  {q['id']} from {q['byName']} (during {q['phase']}{', proposal ' + str(q['proposal']) if q.get('proposal') else ''}): {q['text']}")
    if s.get('rulings'): print(f"last ruling: {s['rulings'][0]['text']}")
    print('recent:'); [print('  ' + e['t']) for e in s['log'][:6]]

def fingerprint(s):
    return (s['phase'], s['turnNumber'], len(s.get('requests', [])), s['nextProposal'], len(s.get('proposal', {}) .get('votes', {}) if s.get('proposal') else {}), len(s['players']), tuple(p['score'] for p in s['players']))

def main(argv):
    if not argv or argv[0] in ('-h', '--help'): print(__doc__); return
    cmd, args = argv[0], argv[1:]
    if cmd == 'status': status(state())
    elif cmd == 'rules':
        for r in state()['rules']: print(f"{r['n']} {'(immutable)' if not r['mutable'] else '':<12} {r['text']}\n")
    elif cmd == 'history':
        for h in state()['history']: print(f"{h['n']} {h['byName']}: {h['kind']}{' ' + str(h['target']) if h.get('target') else ''} — {'adopted' if h.get('adopted') else 'lapsed' if h.get('lapsed') else 'void (' + h['void'] + ')' if h.get('void') else 'defeated'} {h.get('yes', 0)}–{h.get('no', 0)}\n  {h.get('text', '')}")
    elif cmd == 'wait':
        limit = float(args[0]) if args else 600
        s0 = state(); f0 = fingerprint(s0); t0 = time.time()
        while time.time() - t0 < limit:
            time.sleep(1.5)
            s = state()
            if fingerprint(s) != f0:
                status(s); return
        print('nothing happened.')
    elif cmd == 'sit': post('/bridge/judge', {'present': True, 'name': args[0] if args else 'Claude'}); print('seated.')
    elif cmd == 'leave': post('/bridge/judge', {'present': False}); print('left.')
    elif cmd == 'rule':
        text = args[0]; rid = args[args.index('--for') + 1] if '--for' in args else None
        send({'type': 'ruling', 'text': text, 'requestId': rid})
    elif cmd == 'adjust': send({'type': 'adjust', 'name': args[0], 'delta': float(args[1]), 'reason': args[2] if len(args) > 2 else ''})
    elif cmd == 'set':
        v = args[1]; v = {'true': True, 'false': False}.get(v.lower(), v)
        send({'type': 'setting', 'key': args[0], 'value': v if isinstance(v, bool) else float(v)})
    elif cmd == 'void': send({'type': 'void', 'reason': args[0] if args else 'judgment'})
    elif cmd == 'strike': send({'type': 'strike', 'n': int(args[0]), 'reason': args[1] if len(args) > 1 else ''})
    elif cmd == 'remove':
        s = state(); p = next((p for p in s['players'] if p['name'].lower() == args[0].lower()), None)
        if not p: sys.exit('no such player'); 
        send({'type': 'forfeit', 'id': p['id']})
    elif cmd == 'newgame': send({'type': 'newgame'})
    else: sys.exit('unknown command; judge.py --help')

if __name__ == '__main__':
    try: main(sys.argv[1:])
    except urllib.error.URLError as e: sys.exit(f'bridge not running ({e.reason}) — start it: python3 bridge/nomic-bridge.py')
