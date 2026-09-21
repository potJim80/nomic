#!/usr/bin/env python3
"""A seat at the table for Claude Code — the same thing a phone does, from the command line.

  bot.py join NAME [--code CODE]        sit down (the lobby only). Uses the room from judge.py join, or --code
  bot.py status                         the table from the bot's point of view: what is being asked of it
  bot.py start                          start the game (only if the bot sat down first)
  bot.py propose "text"                 propose a new rule       (on the bot's turn)
  bot.py amend N "new wording"          amend rule N
  bot.py repeal N | transmute N ["text"]
  bot.py vote aye|nay                   vote on the proposal on the table
  bot.py roll                           roll the die (on the bot's turn)
  bot.py ask "question"                 invoke Judgment
  bot.py wait [seconds]                 block until the table changes, then print status
  bot.py forfeit                        leave the game for good
"""
import json, os, sys, time
from table import *

BOT = os.path.join(HOME, 'bot.json')

def load_bot():
    try:
        with open(BOT) as f: return json.load(f)
    except Exception: sys.exit('the bot has no seat yet — run: bot.py join NAME')

def act(room, bot, action):
    # hello first, every time: a screen that reloaded mid-game only knows the seats that re-introduce themselves
    action.update(id=bot['id'], secret=bot['secret'])
    c = MQTT(room['broker']).connect()
    c.publish(topic(room['code'], 'host'), {'type': 'hello', 'id': bot['id'], 'name': bot['name'], 'secret': bot['secret']}, qos=1)
    c.publish(topic(room['code'], 'host'), action, qos=1); time.sleep(0.3); c.close()
    print('sent:', action['type'])

def main(argv):
    if not argv or argv[0] in ('-h', '--help'): print(__doc__); return
    cmd, args = argv[0], argv[1:]
    if cmd == 'join':
        name = args[0]
        if '--code' in args:
            code = args[args.index('--code') + 1].upper()
            broker, s = find_room(code)
            if not broker: sys.exit(f'no table with code {code} — is the screen open?')
            room = {'code': code, 'broker': broker}
            try: room['key'] = load_room().get('key') if load_room().get('code') == code else None
            except SystemExit: pass
            save_room(room)
        else: room = load_room()
        try:
            with open(BOT) as f: bot = json.load(f)
        except Exception: bot = {'id': 'bot-' + os.urandom(4).hex(), 'secret': os.urandom(8).hex()}
        bot['name'] = name
        with open(BOT, 'w') as f: json.dump(bot, f)
        c = MQTT(room['broker']).connect()
        c.publish(topic(room['code'], 'host'), {'type': 'hello', 'id': bot['id'], 'name': name, 'secret': bot['secret']}, qos=1); time.sleep(0.5); c.close()
        print(f'{name} sat down at {room["code"]}.'); return
    room = load_room(); bot = load_bot()
    if cmd == 'status': print_status(read_state(room), me=bot['id']); print(f"you are {bot['name']}")
    elif cmd == 'wait':
        s = watch(room, float(args[0]) if args else 600)
        print_status(s, me=bot['id']) if s else print('nothing happened.')
    elif cmd == 'start': act(room, bot, {'type': 'start'})
    elif cmd == 'propose': act(room, bot, {'type': 'propose', 'kind': 'enact', 'text': args[0]})
    elif cmd == 'amend': act(room, bot, {'type': 'propose', 'kind': 'amend', 'target': int(args[0]), 'text': args[1]})
    elif cmd == 'repeal': act(room, bot, {'type': 'propose', 'kind': 'repeal', 'target': int(args[0])})
    elif cmd == 'transmute': act(room, bot, {'type': 'propose', 'kind': 'transmute', 'target': int(args[0]), 'text': args[1] if len(args) > 1 else ''})
    elif cmd == 'vote': act(room, bot, {'type': 'vote', 'yes': args[0].lower() in ('aye', 'yes', 'y', 'true')})
    elif cmd == 'roll': act(room, bot, {'type': 'roll'})
    elif cmd == 'ask': act(room, bot, {'type': 'judgment', 'text': args[0]})
    elif cmd == 'forfeit': act(room, bot, {'type': 'forfeit'})
    else: sys.exit('unknown command; bot.py --help')

if __name__ == '__main__':
    try: main(sys.argv[1:])
    except (ConnectionError, OSError) as e: sys.exit(f'broker trouble: {e}')
