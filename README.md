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

**Timed Mode** — Available in both Pass & Play and Online Multiplayer. Each player has their own countdown clock (1, 3, or 5 minutes). When a player's time runs out, their orbs are eliminated from the board with an animation and play continues without them. A timed mode indicator showing the time limit per player is displayed in the waiting room and throughout the game.

### Player Setup

Up to 8 players are supported, each assigned a unique colour. Before starting, each slot can be configured as Human, AI, or Hard AI. Tap a ball once for Human, twice for AI, three times for Hard AI, and once more to deactivate it.

### Grid Sizes

Five grid sizes are available: 6×6, 7×7, 8×8, 9×9, and 10×10.

### AI Opponents

The Normal AI is based on the heuristic approach described by [Keshav Agrawal](https://keshav.codes/chainreaction/), using a minimax algorithm with a search depth of 1–2 moves. Hard AI is based on the approach from [notshridhar/chain-reaction-ai](https://github.com/notshridhar/chain-reaction-ai), searching 3–4 moves deep with alpha-beta pruning for noticeably stronger play. Both difficulty levels scale their search depth automatically based on grid size to remain responsive. AI computation runs in a dedicated Web Worker to keep the UI thread responsive.

### Online Multiplayer

- Create a private room and share the code with friends, or join one using a code
- Optional room passwords to restrict access to invited players
- Random matchmaking to be paired with any available public room
- Timed Mode configurable from the create room screen, with the time limit synced to all players
- A 30-second per-turn timer synced to Firebase's server clock, ensuring accuracy regardless of each device's local system time
- The per-turn timer resets to a full 30 seconds for each new player's turn — including after a forced move or a player disconnect
- If a player's per-turn timer runs out, a move is forced on their behalf by placing on a random owned cell (or a random empty cell if they own none)
- In-game chat with an unread message counter and a red dot indicator on the chat button when new messages arrive with the panel closed
- Rematch system — after a game ends, any player can propose a rematch. All players must accept for a new game to begin. A 10-second auto-decline countdown is shown to those who haven't responded
- Disconnect handling so remaining players are notified if someone leaves mid-game

### Visuals and Effects

Orbs animate visually as they fly into neighbouring cells during explosions. A chain combo counter tracks how many consecutive explosions occur in a single move. Ambient background glow, a crown badge on the leading player, and per-move gain badges round out the visual feedback. When a player is eliminated — whether by losing all orbs or by running out of time in Timed Mode — their remaining orbs flash and implode before being removed.

### Settings

A persistent settings panel is accessible via the gear icon below the setup box on menu and lobby screens, and next to the New Game button during a match. All settings are saved to `localStorage` and restored on the next launch. Available options:

- **Music Volume** — controls the background music level
- **SFX Volume** — controls the volume of in-game sound effects
- **Low Graphics** — disables glow, ripple, ambient, and shake effects for lower-end devices. Flying orb animations are retained but rendered as plain flat dots
- **Screen Shake** — independently toggles the grid shake that occurs during chain reactions, without affecting other graphics settings
- **Orb Style** — switch between Glow, Flat, and Number orb appearances

The screen is kept awake automatically during gameplay (both singleplayer and multiplayer) using the Wake Lock API where supported, without requiring any manual setting.

### Music

Background music plays automatically on the first user interaction and switches tracks contextually between screens:

| Screen | Track |
|---|---|
| Main Menu & Online Lobby | Cymdeithas Six — Rob Jenkins |
| Singleplayer (in-game) | Ogof Four — Rob Jenkins |
| Online Multiplayer (in-game) | Pryder Eight — Rob Jenkins |

Tracks loop seamlessly with a short crossfade when switching between screens.

### Other

- Undo — step back one move in local and AI games (unavailable in online mode)
- New Game button with a confirmation prompt to prevent accidental resets during a match
- Exit button on the end screen to return to the main menu directly, without a confirmation prompt
- Match summary on the win screen showing total turns played and the biggest chain combo achieved, with the summary border styled in the winner's colour
- Fully mobile responsive, with the grid and UI scaling to fit screens from desktop down to small phones

---

## How to Play

1. On the setup screen, configure each player slot as Human, AI, or Hard AI
2. Select a grid size
3. Optionally enable Timed Mode and choose a time limit per player
4. Click Start Game
5. On your turn, click any empty cell or any cell you already own to place an orb
6. If a cell reaches critical mass, it explodes — chain reactions resolve automatically
7. You cannot place on a cell owned by another player
8. A player is eliminated once they have no orbs left, provided everyone has made at least one move. In Timed Mode, a player is also eliminated if their clock runs out
9. The last player remaining wins

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
├── index.html                   # Main HTML shell
├── chain-reaction.js            # Core game logic, AI, online multiplayer, Firebase sync
├── chain-reaction.css           # All styles including responsive breakpoints
├── chain-reaction-audio.js      # Background music player (OGG, auto-switches per screen)
├── chain-reaction-sfx.js        # Procedural sound effects (Web Audio API)
├── ai-worker.js                 # AI computation Web Worker
├── audio/                       # OGG background music tracks
│   ├── menu.ogg
│   ├── singleplayer.ogg
│   └── multiplayer.ogg
└── images/                      # Favicon and other assets
```

---

## Tech Stack

| Technology | Purpose |
|---|---|
| Vanilla JavaScript (ES2020) | Game logic, AI, UI |
| Web Workers | AI computation off the main thread |
| Firebase Realtime Database | Online multiplayer state sync |
| Web Audio API | Procedural sound effects |
| HTML Audio API | Background music playback (OGG) |
| Wake Lock API | Keeps screen on during gameplay |
| CSS custom properties + clamp() | Responsive design |
| GitHub Pages | Hosting |

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

## License

This project is open source. You are free to fork, modify, and host your own version.
