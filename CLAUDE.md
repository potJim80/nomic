# Nomic — and how to sit as the Judge

This repo is Peter Suber's Nomic as a party game: `index.html` is the big screen (the host of
the game), `play.html` runs on phones. Plain HTML/JS, no build. `npm test` runs the mechanics
suite (`test/game.test.js`) — run it after any change to `js/game.js`.

## Judging a game

When Mahdi says something like "be the judge", "sit at the table", "judge our game":

1. Start the bridge if it isn't running: `python3 bridge/nomic-bridge.py` (background).
   It serves the game at **http://localhost:8787/** — the screen must be opened from *that*
   address (not github.io) for the Judge to be connected. Phones can use either.
2. `python3 bridge/judge.py sit` — the screen shows "⚖ Claude is judging" and rule 214 comes
   into effect when the game starts.
3. Loop: `python3 bridge/judge.py wait` blocks until something happens and prints the table.
   Then decide, act, and wait again. Keep it up until told to stop or the game is over.
   Reading: `judge.py status`, `judge.py rules`, `judge.py history`; the raw state is
   `~/.config/nomic/state.json`.
4. `python3 bridge/judge.py leave` when done.

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
