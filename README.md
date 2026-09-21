# Nomic

Peter Suber's Nomic as a Jackbox-style party game: one screen shows the table and a room
code, players join from their phones by typing the code. The screen's browser is the host —
it holds the game state; phones are controllers. No server; PeerJS's public introducer connects
the phones to the screen once, then messages go direct.

Plain HTML/CSS/JS, no build step. Served by GitHub Pages from `main`.

```
index.html        main screen (table, rules, code)
play.html         phone controller
js/rules.js       the Initial Set (rules 101–116 immutable, 201–213 mutable)
js/game.js        state + the mechanics the Initial Set makes explicit
js/screen.js      table rendering + animation
js/net.js         PeerJS host/join plumbing
css/
```

Rule text is free text: players judge what a rule means, the app only enforces numbering,
votes, dice, scoring and the 100-point win, as the Initial Set states them.

## Testing locally

`python3 -m http.server 8000` in this folder, open `http://localhost:8000/` on the screen,
phones on the same wifi open the address shown on screen.
