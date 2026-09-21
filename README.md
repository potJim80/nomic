# Nomic

Peter Suber's Nomic as a Jackbox-style party game: one screen shows the table and a room
code, players join from their phones by typing the code. The screen's browser is the host —
it holds the game state; phones are controllers. No server of our own: a public MQTT broker relays
messages between the screen and the phones over websockets (works from any network).

Plain HTML/CSS/JS, no build step. Served by GitHub Pages from `main`.

```
index.html        main screen (table, rules, code)
play.html         phone controller
js/rules.js       the Initial Set (rules 101–116 immutable, 201–213 mutable)
js/game.js        state + the mechanics the Initial Set makes explicit
js/screen.js      table rendering + animation
js/net.js         broker relay: host publishes state, phones publish actions
css/
```

Rule text is free text: players (or Claude, as the Judge — see CLAUDE.md) judge what a rule means, the app only enforces numbering,
votes, dice, scoring and the 100-point win, as the Initial Set states them.

## Testing locally

`python3 -m http.server 8000` in this folder, open `http://localhost:8000/` on the screen,
phones on the same wifi open the address shown on screen.

## Claude Code as the Judge

`bridge/nomic-bridge.py` serves the game at `http://localhost:8787/` and relays between the
screen and `bridge/judge.py`, which Claude Code drives: it reads the live state, answers
players' questions ("Invoke judgment" on the phone), adjusts points and settings as adopted
rules demand, and can void a proposal. Rule 214 (in `js/game.js`) seats the Judge.
