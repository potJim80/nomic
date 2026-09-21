# Nomic — and how to sit as the Judge

This repo is Peter Suber's Nomic as a party game: `index.html` is the big screen (the host of
the game), `play.html` runs on phones. Plain HTML/JS, no build. `npm test` runs the mechanics
suite (`test/game.test.js`) — run it after any change to `js/game.js`.

## Judging a game, or playing in it

The screen (`index.html`, anywhere — usually https://potjim80.github.io/nomic/) shows a
**room code** and, under the QR code, a **Judge key**. Mahdi reads both to you. Everything
below talks to the game through the public broker; nothing runs on the screen's machine.
`bridge/mqttws.py` is a stdlib MQTT-over-websocket client; no installs.

When Mahdi says "be the judge", "sit at the table", "judge our game":

1. `python3 bridge/judge.py join CODE KEY` — finds the room, remembers it.
2. `python3 bridge/judge.py sit` — the screen shows "⚖ Claude is judging"; rule 214 is in
   effect (at the start, or at once if the game is already on).
3. Loop: `python3 bridge/judge.py wait` blocks until something happens and prints the table.
   Decide, act, wait again. Keep going until told to stop or the game is over.
   Reading: `judge.py status`, `judge.py rules`, `judge.py history`.
4. `python3 bridge/judge.py leave` when done.

When he wants a bot at the table ("add a bot", "play against me"):

- `python3 bridge/bot.py join NAME` (lobby only; `--code CODE` if you haven't joined as judge).
- `bot.py status` says what's asked of the bot; `bot.py wait` blocks until the table changes.
  On its turn: `bot.py propose "…"` / `amend N "…"` / `repeal N` / `transmute N`, then
  `bot.py roll` after the vote. During a vote: `bot.py vote aye|nay`. `bot.py ask "…"` invokes
  Judgment. The bot plays to win under the rules as written, and proposes rules that are
  short, testable, and mischievous rather than broken — it's a game.
- Judge and bot can be the same session. Keep the two hats apart: the Judge does not favour
  the bot, and says so if asked.

### What a good Judge does

- Answer every question (`judge.py rule "…" --for q3`) — short, decisive, citing the rule
  number that decides it. Players read it on their phones and on the felt; two or three
  sentences at most. Rule 212's spirit: when the rules are silent, go by game-custom and the
  spirit of the game.
- When an adopted rule changes a number the app enforces (win score, penalties, die, the vote
  threshold), apply it: `judge.py set winScore 60`. The app only enforces the Initial Set's
  numbers by itself.
- When an adopted rule awards or costs points that the app can't see ("players who rhyme gain
  2"), watch the proposals and apply them: `judge.py adjust Ada 2 "rule 305: rhymed"`.
- Void a proposal that breaks an immutable rule (110, 112, 114…) or is two changes in one
  (111): `judge.py void "rule 112: the win condition can't be changed to something other than points"`.
- Don't rule unprompted more than once in a while; the table plays, the Judge settles.
- Never touch scores or rules for taste. Only for what the rules, as written, require.

The players can overrule a ruling by unanimous vote (rule 214, echoing 212); if they do,
say so in the next ruling and undo it.

## Testing without a room full of people

- `index.html?demo` — five pretend players play by themselves.
- `index.html?code=ABCD` pins the room code so scripted phones can join.
- The headless renderer used during development lives in the assist scratchpad
  (`shots.swift`); it doesn't tick CSS animations, so it zeroes them before capturing.
