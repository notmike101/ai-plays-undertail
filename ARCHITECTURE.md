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
- Movement is 0.10 capture px per ms of held key (re-measured; this file used to say 0.3, then 0.18 - see
  the slam section for the measurement and why the old numbers were wrong). The camera follows the player,
  so the player's *screen* position is nearly constant mid-room and only changes at room edges. Measure
  travel by whether the picture changed, not by my screen position: measured 3k changed px for a key held
  into a wall (my own walk animation), 77k px for real walking, 1.5k px standing still, so `move.mjs` uses
  a 12k threshold.

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
- Consecutive captures are matched by a pixel-offset search along the held axis from 0 (camera clamped)
  to the commanded shift plus slack (`expected = 0.10 px per ms of held key`), and candidates that imply
  more travel than that hold could produce are dropped. The winning offset is the camera displacement, so
  `world = camera + my on-screen anchor` and the collision point is `anchor.y + 13` (the feet, not the
  hair).
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
  to the commanded shift plus slack. Speed re-measured twice on the current build and both agree on
  0.10 px per ms: `motion.mjs` over the
  leaf-square border (a non-repeating ROI) gave 90 px for a 900 ms hold and 36 px for 400 ms, and slam's
  own per-step world deltas for a 900 ms hold ran 66-108 px. The earlier 0.183 figure (a vine patch
  "slid 588 -> 264 px over 1800 ms") does not reproduce and most likely measured a room-transition
  camera scroll, not a walk. Getting this wrong is not cosmetic: align ties near-equal offsets to the
  commanded shift, so an 80 % over-prediction stamps ~60 px of travel per flat-floor step and stretches
  the whole map. A 1500 ms hold that moved only 84 px was a wall, not slow walking.
- Navigation: BFS on the grid, re-planned every step, one 90-150 ms key hold per step (~9-15 px at the
  measured 0.10 px/ms). A byte-identical frame after a key hold means the game paused when its window lost
  focus, so the step calls `refocus()` and presses again before the zero-move is believed as a wall.
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
- Two traps in reading my own evidence. A stationary NPC looks like a walking one once the camera
  scrolls: the only honest comparison is sprite against a fixed wall inside the same frame, which is how
  I came to claim Toriel paces when she had not moved a tile in 24 s. And `OTH` blobs are not furniture -
  my sprite's face is yellow, so a line of yellow along the trail is my own footsteps; I read that as
  floor pressure plates.
- `src/motion.mjs` answers the one question my eye kept getting wrong: did this box of the frame move, and
  by how much. It grabs a raw frame, runs an action, grabs again, and reports the offset that best
  re-aligns a region of the first frame inside the second (`match x0 y0 x1 y1 [maxshift] [cmd...]`, or
  `files a.bin b.bin ...` for saved grabs). Run it over a fixed wall and over the object of interest: the
  object's real motion is the difference between the two offsets, which is the only way I have to tell a
  scrolled camera from a moved sprite. It reuses slam.mjs's torn-grab test after my own version - sampling
  four pixels per row - declared every healthy frame smeared.
- `motion.mjs` had a positional bug that hid it: `match x0 y0 x1 y1 <maxshift> <cmd...>` left the shift
  bound in the command list, so it ran `play.mjs 40 hold ...` ("unknown cmd: 40") and died before frame B
  was grabbed. The bound is now optional and recognised by shape. This is why the push/NPC measurements
  the handoff told me to run had never actually produced a number.
- Foreground is part of the input path, and its loss looks like geography. SendInput only reaches the
  FOREGROUND window; Task Manager held it on this machine, bridge's `AttachThreadInput +
  SetForegroundWindow` pull was refused against it, every key was eaten and the frames came back
  byte-identical. A mapper that believes "0 px of movement" would have recorded a WALL there.
  `slam.mjs` now calls `refocus()`: bridge's `focus` first, then `tools/refocus.ps1`, which uses the
  alt-tab primitive (`SwitchToThisWindow`), clears the foreground-lock timeout, and as a last resort
  minimizes the blocking window - never one whose title contains OBS.
- `slam nudge <dir> [ms]` is the walkability probe: one verified `step()` reported as a distance, so a
  "can I walk here" test stays inside the mapper (paint + footfalls follow it) instead of hand-driving,
  which invalidates the grid.
- `slam.mjs` is import-safe (`pathToFileURL` guard) and exports `classify`, so helper tools can reuse the
  classifier instead of copying colour thresholds and drifting from them.
- `writePng` also emits `roomN-fit.png`: the painted bounding box scaled to ~1100 px with my own cell
  drawn white. A 1600x1000 canvas at 1 px per cell was unreadable, which is why every map read had gone
  through the narrow `show` window.
- New census helpers, both used before any classifier change: `tmp_palette.mjs [x0 y0 x1 y1]` inventories
  the live frame's colour buckets with the count, bbox and slam's verdict for each (this is how the new
  room's palette got named: pale plateau `(200,194,226)`, grey wall face `(95,94,119)`, dark purple
  `(97,44,97)`, red hedge `(232,35,19)`/`(128,17,17)` - all OTH, i.e. unnameable, so they stay UNKNOWN
  and `passable()` probes them rather than me guessing a class). `tmp_crop.mjs out.png x0 y0 x1 y1
  [scale]` zooms a window of a frame so sprites, decals and sign glyphs are legible.

### Two different numbers were hiding in one constant
- **My sprite travels at 0.18 px/ms; the scenery scrolls slower than that.** Measured separately, on
  purpose: `tools/rate.mjs` walks a fixed hold and reads **my sprite position** before/after (in the
  Ruins rooms the whole room fits the window, so the camera never scrolls and this is the only honest
  measurement) - three 500 ms and two 1000 ms holds gave 0.174-0.189 px/ms. `src/motion.mjs match`
  measures the **scenery** instead, and gave ~90 px for a 900 ms hold because the overworld camera
  LERPS: it is still catching up when the key is released, and in a small room it never moves at all.
- `PXMS = 0.18` is now the single physical speed (the physics bound in `step()`, the press-length
  calculation). `CAM_MS = 0.10` is only where `align()` aims its search. They were the same constant
  before, which is how a previous session "re-measured" 0.10: `align()` built its candidate window as
  `[0 .. exp + 14]` with `exp = ms * PXMS`, so with 0.10 a real 160 px scroll was **outside the search
  space** and every reading confirmed the constant. The window now spans `[0 .. ms*PXMS + 14]`, and
  the selftest's stripe case checks that the 27 px-pattern alias at 162 px is inside that window and
  still loses to the true 90 px shift.
- `motion.mjs` has exactly two verbs: `match` and `files`. There is **no `measure` verb**; unknown
  arguments fall through to "park a grab", which is what made an earlier measurement look like a result.
- `playerPosFrom` consumes a **raw 646x520 BGRA buffer**, never a PNG. Feeding it a PNG file returns
  null for every frame and proves nothing; a check of that kind must grab with
  `play.mjs raw grab logs/x.bin` first. (All four facings were then tested live: hair blob n 1284 /
  952 / 732 / 732, so side-facing sprites are not the detection gap people assumed.)
- A step whose sprite cannot be located no longer returns `{lost}` and freezes the bookkeeping.
  `foldStep()` (pure, now selftested) folds the measured camera scroll into `cam`/`world` either way,
  so the position follows the evidence instead of sitting at the last located sprite: three `nudge`
  calls in a row on the plateau had reported `{"lost":true}` while the shot showed I had crossed 330 px.
  `step()` still reports `lost: true` so the caller can settle the sprite, and the feet disc is stamped
  at the scroll-implied position - an estimate bounded by the physics check, not a guess.

### Colour may call a cell unknown, never solid
- The six ring cobbles are `rgb(192,192,192)`, which the colour test calls SPIKE - the same grey family
  as the spike tiles. They were therefore obstacles in the map, and `bodyFit` vetoed every cell within
  3 cells of one, which sealed off most of the room. Physical test: `tools/inset.mjs right 419 291 436 306`
  walked my feet through the drawn body of a stone (`412 -> 454 -> 490 -> 526`) and only the room's east
  wall stopped me; my 34 px-wide drawn body also overlaps a stone's drawn box while standing beside it.
  **The drawn sprite is not the collider**, so no colour-derived class may be trusted as a wall.
- Shape separates the two greys: `flatGrey(r)` marks a SPIKE run at least as wide as it is tall (the
  cobbles are 28x16 px = 14x8 cells) as floor; a spike standing taller than wide (6x20 cells in the
  selftest) keeps its solid verdict. `walkable`, `bodyFit` and `passable` consult `FLAT`.
- `THIN` and `FLAT` are module scratch that only `paint()` used to rebuild, so `probe`, `reach` and
  `walk "to"` - which flood without painting a frame - ran with **empty masks** and saw every thin brick
  band, black gate and flat decal as solid. `loadRoom()` now runs `thinBrick` + `thinDark` + `flatGrey`;
  "routable from me" went from 1 to 30787 cells in a room I had walked 151 steps around.
- Pockets are repaired, not obeyed: standing 3 cells from a BRICK wall, `bodyFit` vetoed all four
  directions and the walk quit with 58 routable cells in a 26802-cell room. `pickFrontier` now repairs
  seams + footprints whenever the flood from my cell returns fewer than 400 cells (not only when there
  is no frontier). The repair flag lived in the room's meta, so "repair once" meant once per room
  **forever** and the next walk inherited `repairTried=1` and gave up at step 0; it is reset at the
  start of every walk. (No synthetic case for this one: a mock world that reproduces it would be
  testing the mock. It is verified live, on the room that triggered it.)

### Flat grey decals are floor
- The switch room's floor carries **grey decorative plates**: runs of the cobble grey (~34x17 px) with
  dark notches at the corners, plus grey L/T trim pieces along the room's south-west edge. Same grey
  family as the spike tiles, so the colour test called them `SPIKE` and `bodyFit` sealed off the room.
  `flatGrey` is width >= height, which the plates pass and the trim fails, so `paint()`'s "is the whole
  run flat?" test fell back to solid for the trim pixels.
- Two-part fix. `classify()` now calls pale grey floor (not SPIKE) when the 3x3 neighbourhood is
  dominated by pale floor/OTH and no dark outline touches it - so a decal interior never enters the run
  test at all. And the room masks (`thinBrick`, `thinDark`, `flatGrey`, `BOX`) are computed in `loadRoom`
  as well as in `paint`, which is the single reason `reach`/`probe`/`walk "to"` can be trusted at all:
  they flood without painting, and `walk "to" 1211 460` was refusing a target **5 cells away** because
  `FLAT`/`THIN` were empty for a command that never paints.

### A blob found far away is not motion
- Cornered between water, Toriel and a wall, three nudges reported 86, 210 and 0 px while consecutive
  frames showed me in the identical pixel position. `motion.mjs match 290 200 350 270 60 hold right 900`
  measured mean |d| **0.0** across the box containing my own sprite. The colour detector had locked onto a
  brown patch across the room; `align` was right (no scroll) and `sm` was a lie, so `foldStep` teleported
  my recorded position 210 px and `paint` stamped walked floor where I had never stood.
- `blobStill(A, B, cx, cy)` measures the mean luma change in a 40x56 box around where my sprite was. If the
  window did not scroll and that box did not change, the step is recorded as **no motion**, my last located
  position is kept, and the step returns `phantom: true` so callers can tell it from a lost sprite.

### A message box reads as a wall
- The walk loop dismisses boxes; `nudge` did not, so three nudges against Toriel's note plaque reported
  "blocked" and I nearly called a plaque a wall. `nudge` now re-grabs, and on `moved < 6` with a box on
  screen it dismisses, waits and re-holds once.
- `tools/xfire.mjs [play.mjs args...]` is the change detector for claims like "the switch did nothing":
  raw grab, action, raw grab, then it prints the number of differing pixels and the bbox they cover. It is
  what showed that pressing `z` at the yellow plaque-lever changed the box and my sprite but never the
  handle nub inside the slot (crops at 10x of `300,130-350,180` before/after were pixel-identical).

### Reusing a room is a claim about pixels, not about landmark counts
- `matchRoom` reported "that is room 0 again (112 landmarks line up)" on transitions between rooms I had
  never seen, twice in one walk. The signature is scenery offsets relative to my own cell, which is
  camera-proof - but the Ruins reuse the same brick band, pale floor and void everywhere, so a translated
  alignment of those offsets clears the 55% majority test for a different room. Trusting it welds rooms into
  one grid (`786..1477 x 341..763` cells, 1324x932 px, smeared seam) and the map then reports
  `routable from me 2` while holding 117434 walkable cells.
- `frameAgreement(r, b, cam)` votes each visible cell's class the way `paint()` does and compares it with the
  stored cell: `UNKNOWN`/`BLOCKED` cannot contradict, my body/robe/message-box cells are skipped, the two
  pale floor classes count as one surface. The transition handler settles the incoming frame **before**
  deciding the match, then refuses the reuse below 70% agreement across at least 300 known cells and mints a
  new room instead. Under 300 known cells there is nothing to contradict, so landmarks still decide.
- Ordering mattered: the frame used to be grabbed after the reuse decision, so the pixels could not be part
  of the test.

### A cached OCR line convinced a walk it was being talked to
- `walk frontier 400` livelocked at cell (159,184) from step 41 to step 399, the log alternating "the game is
  talking, movement frozen: . ?? ? ." / "broke contact going up" / "left moved 7px". After the walk I pressed
  `z` on the spot and took a shot: **there was no message box on screen at all**, and `play.mjs text` returned
  the same `". ?? ? ."` on every call. The box had closed long ago - the text line is cached, and the walk
  believed the cache instead of the frame. It then pressed `z` at scenery, sidestepped, replanned back onto the
  same cell, and repeated 360 times. Nothing in the loop ever asked whether a box was drawn.
- Fix: `hasMessageBox(b)` (`boxRect(b) !== null`) is now the gate on every claim that the game is talking.
  `clearBox` breaks out at once when no box is drawn, and the walk branch only reads the OCR when the pixels
  show a box. `selftest` pins both directions: a drawn box registers, one pale edge does not.
- The guard that exists for this (`dialogEvents > 10`) never fired because it also required `moved < 6`, and the
  contact-breaking sidestep always moved 7-80 px. Movement is not progress: the escape moved me and the route
  dragged me back. Two guards replace it - a `TALKER` mask, reset at the start of every walk, that `passable()`
  refuses over a 21x21-cell disc once a cell has **actually** opened a box 3 times (a 7x7 patch around where I
  stand is exempt so the ban cannot seal the walk in), and a hard stop after 8 dismissals at one cell. Those are
  for genuine repeat-talkers, of which Toriel is one: she re-opens her note whenever I face her.
- I first wrote this section claiming the channel's framed water outlet was an interactive object that kept
  talking. **Withdrawn**: the shot shows no box there. The framed outlets remain unidentified.
