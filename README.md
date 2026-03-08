# Chain Reaction

A browser-based implementation of the classic Chain Reaction board game, playable locally, against AI opponents, or online with friends in real time.

**[Play it live](https://prometheus6074.github.io/chain-reaction/)**

---

## What is Chain Reaction?

Chain Reaction is a strategic board game for 2 to 8 players. Players take turns placing orbs into cells on a grid. When a cell reaches its **critical mass** — equal to the number of its adjacent neighbours — it explodes, sending orbs flying into those neighbours and potentially triggering a cascade of further explosions. Any captured orbs convert to the current player's colour. The last player with orbs remaining on the board wins.

Critical mass varies by cell position:
- Corner cells — 2 orbs
- Edge cells — 3 orbs
- Interior cells — 4 orbs

---

## Features

### Game Modes

**Pass & Play** — Share a single device with up to 8 local players, passing it around between turns.

**vs AI** — Play against a computer opponent at Normal or Hard difficulty.

**Online Multiplayer** — Play over the internet with friends using a 6-character room code, with optional password protection and random matchmaking.

### Player Setup

Up to 8 players are supported, each assigned a unique colour. Before starting, each slot can be configured as Human, AI, or Hard AI. Tap a ball once for Human, twice for AI, three times for Hard AI, and once more to deactivate it.

### Grid Sizes

Five grid sizes are available: 6×6, 7×7, 8×8, 9×9, and 10×10.

### AI Opponents

The Normal AI is based on the heuristic approach described by [Keshav Agrawal](https://keshav.codes/chainreaction/), using a minimax algorithm with a search depth of 1–2 moves. Hard AI is based on the approach from [notshridhar/chain-reaction-ai](https://github.com/notshridhar/chain-reaction-ai), searching 3–4 moves deep with alpha-beta pruning for noticeably stronger play. Both difficulty levels scale their search depth automatically based on grid size to remain responsive.

### Online Multiplayer

- Create a private room and share the code with friends, or join one using a code
- Optional room passwords to restrict access to invited players
- Random matchmaking to be paired with any available public room
- A 30-second turn timer synced to Firebase's server clock, ensuring accuracy regardless of each device's local system time
- In-game chat visible to all players in the room
- Disconnect handling so remaining players are notified if the host leaves

### Visuals and Effects

Orbs animate visually as they fly into neighbouring cells during explosions. A chain combo counter tracks how many consecutive explosions occur in a single move. Screen shake, ambient background glow, a crown badge on the leading player, and per-move gain badges round out the visual feedback.

### Music Player

A built-in MIDI music player powered by [SpessaSynth](https://github.com/spessasus/SpessaSynth) provides a 15-track soundtrack. Controls include previous, play/pause, next, a volume slider, and a seek bar. The player repositions itself contextually between the setup screen, online lobby, and in-game view.

### Other

- Undo — step back one move in local and AI games (unavailable in online mode)
- New Game button with a confirmation prompt to prevent accidental resets
- Fully mobile responsive, with the grid and UI scaling to fit screens from desktop down to small phones

---

## How to Play

1. On the setup screen, configure each player slot as Human, AI, or Hard AI
2. Select a grid size
3. Click Start Game
4. On your turn, click any empty cell or any cell you already own to place an orb
5. If a cell reaches critical mass, it explodes — chain reactions resolve automatically
6. You cannot place on a cell owned by another player
7. A player is eliminated once they have no orbs left, provided everyone has made at least one move
8. The last player remaining wins

---

## Online Multiplayer Setup

The live version linked above has Firebase pre-configured. If you want to self-host with your own Firebase project:

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a project, add a Web App, and copy the config object
3. In the left sidebar navigate to Build → Realtime Database → Create database
4. Set your database rules for open play:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

5. Open `chain-reaction.js` and replace the `FIREBASE_CONFIG` block at the top of the file with your own config values

---

## File Structure

```
chain-reaction/
├── index.html                     # Main HTML shell
├── chain-reaction.js              # Core game logic, AI, online multiplayer, Firebase sync
├── chain-reaction.css             # All styles including responsive breakpoints
├── chain-reaction-midi.js         # MIDI music player (SpessaSynth integration)
├── chain-reaction-sfx.js          # Sound effects
├── spessasynth_processor.min.js   # SpessaSynth AudioWorklet processor
├── soundfont.sf3                  # SF3 soundfont for MIDI playback
├── midi/                          # MIDI track files (15 tracks)
└── images/                        # Favicon and other assets
```

---

## Tech Stack

| Technology | Purpose |
|---|---|
| Vanilla JavaScript (ES2020) | Game logic, AI, UI |
| Firebase Realtime Database | Online multiplayer state sync |
| [SpessaSynth](https://github.com/spessasus/SpessaSynth) (ESM via jsDelivr) | In-browser MIDI synthesis |
| Web Audio API + AudioWorklet | Music playback |
| CSS custom properties + clamp() | Responsive design |
| GitHub Pages | Hosting |

No build tools, no frameworks, and no dependencies to install. Open `index.html` directly in any modern browser.

---

## Browser Compatibility

| Browser | Local Play | Online Play | Music |
|---|---|---|---|
| Chrome / Edge (desktop) | Yes | Yes | Yes |
| Firefox (desktop) | Yes | Yes | Yes |
| Safari (desktop) | Yes | Yes | Yes |
| Chrome (Android) | Yes | Yes | Yes |
| Cromite (Android) | Yes | Yes | Yes |
| Safari (iOS) | Yes | Yes | Yes |

Music requires a user interaction before playback begins, in line with browser autoplay policies.

---

## Soundtrack

| Title | Artist |
|---|---|
| End of Line | Daft Punk |
| Derezzed | Daft Punk |
| Last Chance | Vs. Tabi (Friday Night Funkin') |
| B-Messenger | Steins;Gate 0 |
| Septette for the Dead Princess | Touhou 6 |
| Re:Awake | Steins;Gate 0 |
| The Young Descendant of Tepes | Touhou 6 |
| U.N. Owen Was Her? | Touhou 6 |
| The Maid and the Pocket Watch of Blood | Touhou 6 |
| Lunar Clock ~ Lunar Dial | Touhou Luna Nights |
| Killer | JoJo's Bizarre Adventure |
| Ashes on the Fire | Attack on Titan |
| Bloody Tears | Castlevania |
| Abyss Watchers | Dark Souls III |
| Entrance | Deemo |

MIDI arrangements by [tutogamer2a](https://onlinesequencer.net/2955883). Soundfont by [mrbumpy409/GeneralUser-GS](https://github.com/mrbumpy409/GeneralUser-GS).

---

## License

This project is open source. You are free to fork, modify, and host your own version.
