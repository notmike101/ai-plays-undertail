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

- Frame geometry first: `raw grab` is 646x520, 4 bytes per pixel in B,G,R,A order (1343680
  bytes), rows 0-37 are the window title bar. The sampling window is x 2-641, y 40-515. A
  window that ran to x=759 read past
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
- Physical evidence outranks colour: `PROVEN` (my collision box occupied that cell) may never be
  downgraded to an impassable class by a repaint, and `markBlocked` will not wall off such a cell.
  `stoodRepair` sweeps the collision box along every trail segment after each paint - footfalls
  land ~13 cells apart, so repairing only the exact cells leaves `bodyFit` nowhere to step. This
  room's walkable floor is drawn with mortar lines and 1-2 px black seams, which the mortar vote
  reads as a raised wall: 185 of 828 footfalls sat on cells painted BRICK or VOID, and the walker
  reported 2 cells routable from its own position.
- Sprites are painted out, but only the parts that lie: the blue dress box under my anchor and
  a size-checked NPC robe (the brickwork shares the robe colour, so an unbounded colour bbox
  punched half a room of holes). My head and hair classify as unnameable and are dropped
  anyway. Masking the whole body leaves an UNKNOWN hole the size of the sprite, and BFS only
  steps a cell or two into unknown ground, so that hole sealed every room around me;
  `markFeet` therefore claims the feet row (~19x6 cells) as `PROVEN` - the ground my sprite
  stands on, which the camera cannot see. A failed step walls the ground ahead of me, but never a
  cell my collision box has already occupied: a footprint is stronger evidence than a refused step.
- Reachability, not crow-flies distance: `flood` walks the whole grid once per planning round
  and `pickFrontier` takes the UNKNOWN cell adjacent to known floor that is farthest by real
  walking distance and within 3 cells (6 px) of a cell I can actually occupy. The previous list
  scanned only +-320 cells around me, so the unexplored edge behind me - where the doorway out
  of a room is, once I have walked away from it - was never a candidate, and a room that was a
  third blank got declared finished. Requiring BFS to stand on the exact target was the other
  half: frontier cells hug walls, and my collision box refuses a cell with known solid within 3
  cells sideways, so no wall-side frontier was ever reachable.
- Black has two meanings in this art: a real pit, and the 1-2 px seam between floor tiles.
  `thinSeamsToFloor` runs after every paint and drops any VOID run thinner than 4 cells in
  either direction; voids that are wide in both directions stay solid. Left in the grid the
  seams are known solid, `bodyFit` refuses to path within 3 cells of known solid, and seams
  6-7 cells apart therefore seal a corridor - the room becomes internally disconnected and the
  walker cannot leave it. `slam clean` applies the pass to grids painted before the fix.
- A room change is decided by how much of the picture is *replaced*, not by the mean pixel
  difference: pool ripples and spike tiles inflate the mean on their own, and a camera scroll
  bigger than the +-12 px window makes every candidate offset cost the same. `classifyShift`
  runs a wide coarse-to-fine search first (recovering the scroll), then calls it a new room only
  when more than 45 % of samples mismatch at the best offset. A dark frame (>60 %) is still the
  transition fade, which is allowed up to ~12 s to finish.
- A new room is not assumed. Each room stores the offsets of its scenery landmarks relative to
  the cell under my feet - camera-invariant - and on a transition the new signature is matched
  against every saved room: translations hypothesised from spread landmark pairs, hill-climbed
  whole cells, at least 8 matches and 55 % of the smaller set required. A match reloads that
  grid and puts me on the cell the landmarks say I landed on; only real disagreement starts a
  new room number. That is what stops re-entering a corridor from minting room 4, 5, 6...
- Scenery shift and my own screen motion are two halves of one truth: on flat, featureless
  floor the pixel cost is flat at every offset, so the tie-break toward the commanded shift won
  even when the camera had clamped at a room edge and only my sprite moved. That counted my
  movement twice and stretched the map 2x (vine columns 205 px apart on screen, 410 px apart on
  the grid), which also folded two real rooms into one grid. `align` therefore takes `sm` (my
  anchor's screen movement) and drops any candidate offset that would imply I travelled further
  than the speed model allows for that hold; the held axis is searched from 0 (camera clamped)
  to the commanded shift plus slack. Speed re-measured from the frame: a wall vine patch slid
  588 -> 264 px over 1800 ms of held key = 0.183 px per ms, matching `PXMS = 0.18`.
- Navigation: BFS on the grid, re-planned every step, one 90-150 ms key hold per step
  (~15-27 px). A byte-identical frame after a key hold means the game paused when its window
  lost focus, so the step pulls the window to the foreground and presses again before the
  zero-move is believed as a wall.
  A byte-identical frame is not the only false zero: the game can be talking to me, which freezes
  movement, and `clearBox` has to see that before the walk paints a wall that is not there. See the
  next bullets for how the box is read and dismissed.
- Black is not an obstacle for pathing. The area outside a room is black, and every doorway out
  of it is drawn as a black notch in that same area, so `bodyFit`'s clearance rule (refuse a cell
  with known solid within 3 cells sideways) left no routable cell next to any exit: `probe`
  reported 34k walkable, 28k routable and no frontier in a room whose outline was untouched.
  `SOLID` therefore excludes `VOID` - black is still never *standable* (`walkable()` keeps it
  out), it just no longer shrinks the corridor. `pickFrontier` counts unexplored black as ground
  to look at, gives each gap one honest try, and the walk **presses** into it: bfs cannot stand
  on black, so a short path to a black target becomes a two-node path and the ordinary step
  handler either paints the wall (failed move) or takes me through the doorway (fade).
- A frontier target expires when the picture resolves it. The cell is chosen while UNKNOWN, and
  walking toward it is exactly what paints it: measured as `NO ROUTE from a PROVEN cell to a
  target that is now BRICK`. Nine steps per round were burned heading for a wall that grew under
  me, which showed up as the planner flip-flopping between an east and a south target.
  `walk` now nulls the path the moment the target is neither UNKNOWN nor VOID.
- A message box is detected by its **text**, not by my sprite missing. The sprite stays perfectly
  visible behind a box, and `clearBox` used to return as soon as a grab showed my anchor - so it
  never once pressed the confirm key, and two walks burned 411 steps reading one sentence. It now
  loops while the live OCR has text, printing each new page and pressing `z`, max 4 pages.
- A zero-move step while a box is up is not a wall: the walk reads the live OCR before it paints,
  and a box that keeps re-opening means an NPC trigger zone. The contact-break then holds the key
  450 ms (~80 px) so one step leaves the zone, trying the away direction first and the two
  perpendiculars after; more than 10 pinned dialog events says "an NPC has me pinned" and stops
  instead of spending the remaining budget.
- Three strikes on one move take it off the routing graph: the walk counts failures per
  (cell, direction), `bfs` skips vetoed edges, and `meta.veto` is saved with the room. Before this
  the walker pressed right into the lip of a raised ledge 41 times in 180 steps - replanning kept
  re-entering the same obstacle from the same side, even though paint never erases recorded walls.
- Room identity has been confirmed on the live game, not just in tests: a real fade at step 22 came
  back as "that is room 0 again (119 landmarks line up)", and the reused grid absorbed the new paint
  (walkable 63,480 -> 79,072).
- The mortar vote needs a run at least 4 cells thick. A BRICK band 3 cells or thinner is
  `thinBrick`: probeable, passable, exempt from `bodyFit`. The brick block that bridges the water
  channel is exactly that, and painting it solid is why every `walk "to"` across the channel
  answered "no path" while my feet kept proving it floor.
- `legalAim`: the 8-cell lookahead target must be legal on the vetted graph, vetoed edges included.
  Without it the step aims through an edge the graph already refused - walk35 sawed 34 steps into a
  vetoed edge before this existed.
- A grabbed frame with fewer than 40 distinct scanlines is a torn read, not a picture, so `grab`
  retries it. Measured: a quiet real frame has ~91 distinct scanlines, a real smear ~2.
- `pickFrontier` runs one repair pass (seams, footprints, thin brick) before declaring a room
  finished; paint order can leave a room that looks complete and is not routable.
- A `plankGoal` candidate must be a compact blob (<= 40 cells per axis). Ruins floor is brown brick:
  74k WOOD cells in two 829x195 regions, so colour alone names the floor itself as a plank. One real
  object was 42 cells at world -622,78. `tmp_census.mjs` is what showed this.
- A contact-break sidesteps perpendicular before reversing. Reversing aimed me back into the same NPC
  trigger zone; walk40 lost 52 px of net progress shoving past Toriel.
- OPEN: `probe`'s anchor and a live shot can disagree by (237, -173) px after a room change. A
  fadeless transition keeps the room number and can re-place me wrongly; the disagreement is logged,
  the fix has not landed.
