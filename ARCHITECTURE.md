# Architecture

Engineering notes only. This file must never be used to answer gameplay questions.

## Data flow

```
UNDERTALE.exe (original install, untouched)
      ^  window pixels (PrintWindow), read-only memory reads (ReadProcessMemory)
      |  keyboard events (SendInput, VK)
src/bridge/bridge.exe      native bridge, C#/.NET 4, line protocol on stdin/stdout
src/harness.mjs            Node sidecar: owns bridge child, ws server on 127.0.0.1:8789
src/ocr.mjs                component OCR + trained vocab (ocr/glyphs.json)
src/play.mjs               structured stdio CLI used by the operator
src/walk.mjs               shared detectors: ASCII room map, player anchor, world anchor (plank)
src/move.mjs src/align.mjs closed-loop navigation (measure -> hold -> measure)
src/explore.mjs            coverage walk: world-position tracker + blocked-direction memory
src/where.mjs src/map.mjs  one-shot bbox probes (player+plank; full-screen colour legend map)
src/toriel.mjs             NPC (robe-colour) bbox watcher
src/yscan.mjs              yellow switch-plate finder
logs/dialog.jsonl          every line of on-screen dialogue, appended automatically
```

`ws` is vendored offline into `node_modules/` from an existing local install. No
network use. `node_modules/` and scratch `.bin` dumps are gitignored.

## Bridge commands (stdin line -> one JSON line)

`ping | list | find | fg | focus | hwnd <n> | filter pid=<n> title=<t> substr=1|0 |
shot <path> [blt] | grab <out.bin> [x y w h] | dump <png> <out.bin> [x y w h] |
diff <a.png> <b.png> | key <name> <press|down|up> [scan] [holdms] | held |
scan | box <out.bin> | mem <ascii|%20|hex:BB..> [maxhits] | memr <hexaddr> <len> | quit`

- Default window match: title exactly `UNDERTALE`. `filter` narrows by pid.
- Capture default is `PrintWindow(PW_RENDERFULLCONTENT)`; works for this D3D9 game.
  `blt` grabs the screen rectangle instead (needs an unobstructed window).
- `key` name table lives in `Vk()`; `scan` switches to scancode input.
- `box` finds either text style (filled overworld bubble, outlined battle box) by
  looking for ~all-white rows spanning >=300 px, then hashes the minority colour
  inside (black glyphs on a bubble, white glyphs on the battle box). The hash is
  what the dialog watcher watches for "typing finished".
- `mem`/`memr` are read-only (`PROCESS_VM_READ|QUERY_INFORMATION`). Findings: the
  dialogue strings sit in RAM with control codes (`&` = line break, `^1` = text
  speed), but the displayed message is not kept as one live string object, so a
  pixel-level box watcher is the reliable event source. Used for observation only;
  gameplay decisions come from screen output.

## Harness behaviour

- Always-on dialog watcher: polls `box` at 250 ms; when the ink hash is identical
  on consecutive polls the text is OCR'd once, logged to `logs/dialog.jsonl`,
  printed as `[dialog] ...`, and pushed to every ws client as
  `{event:"dialog",text}` / `{event:"dialogclosed"}`. The operator does not have
  to start a listener to catch text.
- `busyUntil` pauses the watcher while `dodge` runs so bullet reading keeps the
  whole bridge.
- Commands are serialized on the single bridge pipe; `bridgeT` has a per-command
  timeout (120 s for `mem`).

## Engine facts observed while building the interface

- GameMaker-style windowed client area 640x480, window 646x520, ~30 fps.
- Instant down+up taps are dropped by the game's input polling. A hold of
  ~90 ms registers; harness default hold for `press` is 90 ms.
- Input must target the foreground window: the bridge pulls the game window to
  the foreground before every key press.
- The game **pauses when its window loses focus**: the frame stops changing
  entirely (diff = 0). `press enter` resumes it. A static frame plus "keys do
  nothing" usually means paused, or a text box is open (a box blocks movement).
- Movement is ~0.3 px per ms of held key; the camera follows the player, so the
  player's *screen* position is nearly constant mid-room and only changes at room
  edges. Measure travel by whether the picture changed, not by my screen position:
  measured 3k changed px for a key held into a wall (my own walk animation), 77k px for
  real walking, 1.5k px standing still, so `move.mjs` uses a 12k threshold.

## Restart recipe

```
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8789 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force };
  Get-Process bridge -ErrorAction SilentlyContinue | Stop-Process -Force"
powershell -NoProfile -File src/bridge/build.ps1     # bridge (Roslyn csc)
node src/harness.mjs                                 # sidecar (ws on 127.0.0.1:8789)
```

## Known gaps

- OCR vocab is trained only from lines already seen on screen; unseen glyphs
  render as `?` until trained.
- `dodge` sees only blobs inside the battle box.
- Bridge restart requires killing the harness (it owns the child and exits with
  it; file lock on bridge.exe).

## Persistent world map - `src/slam.mjs`

- Frame geometry first: `raw grab` is 646x520 RGBA (1343680 bytes), rows 0-37 are the window
  title bar. The sampling window is x 2-641, y 40-515. A window that ran to x=759 read past
  the end of every row and wrapped into the next one, which smeared the map and offset it 133
  cells east of my real position; that one constant caused the days of "walking in circles".
  `selftest` now asserts the window fits the frame and excludes the title bar.
- Consecutive captures are matched by a pixel-offset search restricted to +-12 px around the
  shift the walker commanded (`expected = 0.18 px per ms of held key`). The winning offset is
  the camera displacement, so `world = camera + my on-screen anchor` and the collision point is
  `anchor.y + 13` (the feet, not the hair).
- Anti-aliasing: the Ruins brick pattern repeats every ~32 px, so the search window is kept
  smaller than that period instead of trusting a global best match. Tie-breaks toward the
  commanded shift apply only inside `best + 1.5` absolute cost; outside that band the strict
  minimum wins, so a clamped camera (cost ~0) is never reported as a move.
- One grid per room: `logs/map/roomN.bin` is a raw `Uint8Array` (1 cell = 2 capture px,
  1600x1000 canvas), `roomN.json` holds the camera, my world position and my trail,
  `current.json` the room index, `prev.bin` the last frame so alignment survives between
  runs. `roomN.png` is written by a small stdlib zlib PNG writer so I can look at the map.
- What counts as solid: void, water, vine, spike tiles, cells the walker physically failed to
  enter (`BLOCKED`), and raised brick walls. A wall is the same purple as the floor - the only
  tell is the mortar colour (132,53,125), 22 % of a wall's pixels and 0 % of walkable floor -
  so `paint` counts mortar per cell and sums it over the 3x3 neighbourhood (>= 14 means wall),
  which turns the lined texture into one solid mass instead of a porous dither. `WOOD` is
  exempt, because the plank I have to carry is brown with a dark outline.
- Sprites are painted out, but only the parts that lie: the blue dress box under my anchor and
  a size-checked NPC robe (the brickwork shares the robe colour, so an unbounded colour bbox
  punched half a room of holes). My head and hair classify as unnameable and are dropped
  anyway. Masking the whole body leaves an UNKNOWN hole the size of the sprite, and BFS only
  steps a cell or two into unknown ground, so that hole sealed every room around me;
  `markFeet` therefore claims the feet row (~19x6 cells) as `PROVEN` - the ground my sprite
  stands on, which the camera cannot see. A failed step overwrites `PROVEN` with `BLOCKED`.
- Frontier targets are UNKNOWN cells adjacent to known floor, farthest first, and a candidate
  is only accepted if BFS has a real path longer than one key hold (~10 cells); otherwise the
  walker overshoots the target and saws left/right over the same tile.
- Room change = align cost above 45, or a frame more than 60 % dark (the transition fade); the
  old room is saved, the index increments, and the new room waits up to ~12 s for the fade to
  finish before starting a fresh grid - giving up earlier strands an unpainted room.
- Navigation: BFS on the grid, re-planned every step, one 90-150 ms key hold per step
  (~15-27 px). A byte-identical frame after a key hold means the game paused when its window
  lost focus, so the step pulls the window to the foreground and presses again before the
  zero-move is believed as a wall.
