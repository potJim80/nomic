#!/usr/bin/env python3
"""The Judge's hand. Claude Code runs these; the screen applies them. Works on any game, anywhere.

  judge.py join CODE KEY                the room code and Judge key shown on the screen (once per game)
  judge.py sit | leave                  take / leave the Judge's seat (rule 214 comes into effect)
  judge.py status                       the table at a glance + open questions
  judge.py rules | history              every rule in effect / past proposals
  judge.py wait [seconds]               block until something happens (a question, a vote, a turn), then print status
  judge.py rule "text" [--for q3]       deliver a ruling (optionally answering question q3)
  judge.py adjust NAME DELTA "reason"   points by judgment
  judge.py set KEY VALUE                winScore unanimous dissenterBonus defeatPenalty dieSides maxMutable circuitsUntilMajority
  judge.py void "reason"                void the proposal on the table: before the vote closes the mover rewrites it; after adoption it is undone
  judge.py strike N "reason"            remove rule N outright
  judge.py remove NAME                  remove a player from the table (rule 113)
  judge.py newgame                      same seats, fresh rules
"""
import sys
from table import *

def cmd_send(room, action):
    action.update(by='judge', key=room['key'])
    send(room, action); print('sent:', action['type'])

def main(argv):
    if not argv or argv[0] in ('-h', '--help'): print(__doc__); return
    cmd, args = argv[0], argv[1:]
    if cmd == 'join':
        code, key = args[0].upper(), args[1].upper()
        broker, s = find_room(code)
        if not broker: sys.exit(f'no table with code {code} on any broker — is the screen open?')
        save_room({'code': code, 'key': key, 'broker': broker}); print(f'room {code} found on {broker}'); print_status(s); return
    room = load_room()
    if cmd == 'status': print_status(read_state(room))
    elif cmd == 'rules':
        for r in read_state(room)['rules']: print(f"{r['n']} {'(immutable)' if not r['mutable'] else '':<12} {r['text']}\n")
    elif cmd == 'history':
        for h in read_state(room)['history']: print(f"{h['n']} {h['byName']}: {h['kind']}{' ' + str(h['target']) if h.get('target') else ''} — {'adopted' if h.get('adopted') else 'lapsed' if h.get('lapsed') else 'void (' + h['void'] + ')' if h.get('void') else 'defeated'} {h.get('yes', 0)}–{h.get('no', 0)}\n  {h.get('text', '')}")
    elif cmd == 'wait':
        s = watch(room, float(args[0]) if args else 600)
        print_status(s) if s else print('nothing happened.')
    elif cmd == 'sit': cmd_send(room, {'type': 'judge', 'present': True, 'name': args[0] if args else 'Claude'})
    elif cmd == 'leave': cmd_send(room, {'type': 'judge', 'present': False})
    elif cmd == 'rule':
        rid = args[args.index('--for') + 1] if '--for' in args else None
        cmd_send(room, {'type': 'ruling', 'text': args[0], 'requestId': rid})
    elif cmd == 'adjust': cmd_send(room, {'type': 'adjust', 'name': args[0], 'delta': float(args[1]), 'reason': args[2] if len(args) > 2 else ''})
    elif cmd == 'set':
        v = args[1]; v = {'true': True, 'false': False}.get(v.lower(), v)
        cmd_send(room, {'type': 'setting', 'key': args[0], 'value': v if isinstance(v, bool) else float(v)})
    elif cmd == 'void': cmd_send(room, {'type': 'void', 'reason': args[0] if args else 'judgment'})
    elif cmd == 'strike': cmd_send(room, {'type': 'strike', 'n': int(args[0]), 'reason': args[1] if len(args) > 1 else ''})
    elif cmd == 'remove':
        s = read_state(room); p = next((p for p in s['players'] if p['name'].lower() == args[0].lower()), None)
        if not p: sys.exit('no such player')
        cmd_send(room, {'type': 'forfeit', 'id': p['id']})
    elif cmd == 'newgame': cmd_send(room, {'type': 'newgame'})
    else: sys.exit('unknown command; judge.py --help')

if __name__ == '__main__':
    try: main(sys.argv[1:])
    except (ConnectionError, OSError) as e: sys.exit(f'broker trouble: {e}')
