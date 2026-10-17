# Progress

## Status (2026-10-17, session 4): back at the Ruins - Entrance save point on a new game instance
- The instance being played changed mid-session: UNDERTALE.exe is now **pid 1332 / window 0x67716**
  (the operator reloaded from the save). pid 12320 / window 0x5505054 is gone. A 200-step frontier walk
  burned 27 steps against the dead capture window; all of its zero-moves and recorded walls are VOID and
  the grid generation was discarded (`slam init`).
- Tooling fixes landed and pushed, all with the failure that produced them: `PXMS` re-measured
  0.18 -> **0.10 px/ms** (plus a selftest case that fails on the old value), `motion.mjs`'s maxshift
  argument bug (its documented invocation never ran), `tools/refocus.ps1` for stolen foreground
  (never minimizes OBS), `slam nudge` as an in-mapper walkability probe, `roomN-fit.png`, and the
  `tmp_palette.mjs` / `tmp_crop.mjs` census helpers.
- **Room named from in-game text:** the room with the pale octagonal plateau, two stair fans, red hedge
  block and leaf-bordered square is **"Ruins - Entrance"** - its floor star is the SAVE POINT
  (`z` while facing it: shadow-of-the-ruins flavour, `HP fully restored.`, then `Ruins Entrance` /
  `File saved.`). Evidence `run1/35_*`, `run1/36_*`.
- Consequence for the run: everything mapped earlier (octagon / corridor / channel / statue / ledge /
  twin rooms) is ahead of me again, so the route must be walked, not resumed. Toriel is not in view in
  this room.
- Resolved: the **east stair fan climbs** onto the pale plateau (walked it: 43 px, then 31 px, then the
  plateau's north edge). Still open: what the red hedge block and the grey wall face hide.
- Through the plateau's black doorway: a room with a **faced magenta door** (it opened by itself once
  Toriel was near), six **stones in a ring** and a yellow `[Z]` sign; walking west from there reaches a
  room with **vines and a water channel crossed by one brick plank**, where Toriel and a grey sign stand.
- First puzzle instruction of the run, read from true adjacency: `To make progress here, you will need
  to trigger several switches.` / `Do not worry, I have labelled the ones that you need to flip.`
  (`evidence/run1/40_*`). The `[Z]` sign's third page was never captured whole and must be re-read with
  the box left to finish typing.
- Tooling, each with the failure that produced it: `refocus()` + `tools/refocus.ps1` (foreground theft
  read as walls); the **PXMS/CAM_MS split** - 0.18 px/ms sprite travel vs the camera's lagging scenery
  scroll, and an align search window that had made the old 0.10 constant self-confirming; `foldStep()`
  so an unlocatable sprite cannot freeze the map; `slam nudge` as the in-mapper walkability probe;
  `roomN-fit.png`; `tmp_palette.mjs` / `tmp_crop.mjs`; `tools/rate.mjs` for the rate. `selftest`
  green, including the new lost-step case and the widened anti-alias case.

## Status (2026-10-17, session 3): the walker can cross the Ruins brick bridge
- `selftest` green. Pushed this session: thin brick (`f1980ee`), `legalAim` (`ebe3d49`), the smear
  guard and its retry bar (`0633f18`, `71704a2`), repair-before-finish plus `plankGoal` compactness
  (`121e009`), sidestep-before-reverse (`965b286`).
- `walk "to x y" N` refuses instantly when the grid calls the goal or the route solid; `N` is the
  step budget (default 60).
- Hand-driving invalidates the grid: any `play.mjs hold` between slam runs means `slam init` after it.
- Two reading rules. A hold that ends is not a wall - re-hold before concluding blocked (0.18 px/ms,
  so 200 ms is ~36 px). And `play.mjs text` lags the frame: a `shot` is the authority on whether a
  box is open.

## Status (2026-10-17, session 2): the map is now something I can remember
- `src/slam.mjs` is the mapper and route planner: capture window x 2..641, y 40..515 (the
  window title bar is outside it), a 2 px-per-cell grid per room, colour classes (floor, pale
  floor, void, water, spike tiles, plank, vine, ground I have stood on, tested wall, raised
  brick) decided by a 3x3 majority per cell. `walk frontier N` explores, `walk "to x y" N`
  goes somewhere specific, and `png` / `show` / `probe` / `clean` inspect the result.
  Maps: `logs/map/roomN.{bin,json,png}`.
- Navigation faults found from the saved maps rather than guessed, each with a selftest
  regression: raised brick painted as floor (mortar count); my sprite hiding the ground under
  it (feet band); tested walls erased by the next frame; `bfs` threading 1-2 cell cracks my
  collision box cannot enter (`bodyFit`); a mid-room step logged as a room change (animated
  water inflates the mean pixel cost - a transition is now decided by the fraction of badly
  mismatched samples, with a wide coarse-to-fine search to recover a camera scroll that
  outran the align window); the floor tiles' 1-2 px black seams painted as pits, which sliced
  corridors in half (`thinSeamsToFloor`, `slam clean`); `bfs` refusing wall-hugging goals
  (arrival is now within 6 px of the target); and the frontier list searching only +-320
  cells around me, so the unexplored edge behind me was never a candidate - one reachability
  flood now ranks unexplored cells by real walking distance.
- Room identity: every room stores a landmark-offset signature (walls, water, spikes, planks,
  vines) relative to the cell under my feet, which the camera cannot change. On a transition
  the new signature is matched against every saved room - translation hypothesised from spread
  landmark pairs, hill-climbed whole cells, 55% of the smaller set must agree. A match reuses
  that grid and places me on the cell the landmarks say I landed on; only real disagreement
  starts a new room number.
- `node src/slam.mjs selftest` runs the regressions: align anti-aliasing, transition
  classifier, seam cleanup, bfs arrival, frontier reach, blocked marking, room identity.

## Status (2026-10-16, session 1)
- Loop works end to end: attach -> capture -> input -> capture -> verify, plus
  automatic text capture.
  - `src/bridge/bridge.exe` (C#): PrintWindow capture, SendInput keys with focus
    pull, `dump`/`grab`, pixel `diff`, battle `scan`, and new this session:
    `box` (finds both text styles - filled overworld bubble and outlined battle
    box - and FNV-hashes the ink), `mem` (read-only pattern scan of the game
    process, ascii or `hex:` needle; 631 MB in ~2.4 s), `memr` (memory hexdump).
  - `src/harness.mjs` (Node + `ws`, ws://127.0.0.1:8789): always-on dialog
    watcher - polls `box` every 250 ms, and when a box's ink settles it OCRs the
    frame once, prints `[dialog] ...`, appends to `logs/dialog.jsonl`, and
    broadcasts a `dialog` / `dialogclosed` event to every connected client. The
    watcher stands down during `dodge` so bullets keep full bridge bandwidth.
  - `src/play.mjs`: shot / press / hold / seq / page / probe / watch / diff /
    scan / dodge / text / readtext / dialoglog / mem / raw; harness events are
    printed to stderr as they arrive.
  - `src/ocr.mjs`: component OCR with a trained vocab (`ocr/glyphs.json`, set
    `dialog`); `lines`, `read`, `train`. Trained this session: D, W, O, I, X and
    the apostrophe, so battle text ("* YOU WON!", "* You earned 0 EXP and 0
    gold.") reads cleanly.
  - Navigation tools (closed-loop, verified against the screen):
    `src/walk.mjs` (ASCII room map; the player is found by the yellow face blob, with a
    dark-hair fallback), `src/move.mjs` (holds a direction and decides from whether the
    picture scrolled - the camera follows me, so my on-screen position is not progress;
    measured: a wall press changes ~3k px of my own animation, walking ~77k),
    `src/probe.mjs` (tries one direction while shifting sideways to reveal a room's
    channels), `src/align.mjs`, `src/yscan.mjs` (`findPlates`).
  - `src/bridge/build.ps1` - repeatable build (Roslyn csc); a bridge rebuild requires
    stopping the harness first (file lock).

## In-game situation (run 1)
- Name HMPO, LV 1, HP 20/20, saved at **Ruins - Entrance**.
- Flower fight (HP 1/20) -> rescued by Toriel -> her home area -> **solved the
  labelled-switch puzzle** and opened the stone gate; Toriel: "Splendid / I am proud of
  you, little one."
- Dummy room: Toriel's lesson ("strike up a friendly conversation / Stall for time").
  My first menu attempt landed on FIGHT; the dummy battle ended "You earned 0 EXP and 0 gold", so
  the conversation she asked for is still un-done. Whether the dummy can be talked to at all is
  unproven: my later `z`/`enter` tests used a verb the client does not implement, so no key ever
  reached the game.
- Maze room: "* There is another puzzle in this room. . ." / "* I wonder if you can
  solve it" from Toriel. Walking out the bottom triggered a **Froggit** encounter; ACT
  -> Compliment gave "* Froggit didn't understand what you said, but was flattered
  anyway.", and the fight closed with "* YOU WON !" / 0 EXP / 0 gold, HP untouched.
  Which action actually closed it is not recorded on screen - noted as a mistake in the
  journal rather than guessed at.
- Plank/water/spike room: read the wall plaque there - "* The western room is the
  eastern room s blueprint." - and the frogger path (three dashes, four dashes) got me
  onto the brown plank, where Toriel blocks the near end and offered no dialogue at the time.
  I did not cross; the only evidence that she is a static obstacle is the movement probe: six
  focused 200 ms right-holds moved me 0 px (a down hold in the same second moved 98 px); the
  `z`/`enter` sends there are void - the client's verb is `press z` - and her box held
  [360,300,390,352] across 30 s of sampling. Water north, spike tiles south, the planks
  starting on the tile under her feet - that room has exactly one other connection: the
  doorway I came in through.
- Walked into a new room through a fade the mapper caught (`fade (room transition in progress)`): a
  symmetric brick "gate" with two vine columns and a cream dummy-like figure; named the Dummy lesson
  room by appearance only, no sign on screen. Three claims from that look are void: the `z` sends never
  reached the game (the client's verb is `press z`), "one screen, the camera never scrolled" was an
  artefact of the double-counted scale, and re-entering that area later put **Toriel in the room**
  repeating the maze-room lines, so the identification itself is unconfirmed. A sign will settle it.
- Wandering east/south from there opened a neighbouring room: brick ledges, two vine
  walls, black pits, and no water, plank or Toriel in view. My screen-coordinate
  bookkeeping went wrong there - the camera clamps at a room's edges, so "no movement"
  sometimes means a clamp, not a wall - so I re-measured with pixel probes instead.
- The screen-only coverage walker (`src/explore.mjs`) traces where I have been by
  comparing my on-screen shift against how much the scenery shifted; it reports blocked
  directions and flags a full-screen replacement (a likely room change).
- Full dialogue record: `logs/dialog.jsonl` (copied to `evidence/run1/`).
- The persistent mapper has been walking that wide brick room (grid `room 0`) from scratch: the
  camera scrolls to 192,191, 211,290 cells painted, 84,702 walkable, 59,630 routable from me.
- A real fade plus a recognized revisit ("that is room 0 again", 119 landmarks line up) - transition
  detection and room identity confirmed on the live game; the reused grid absorbed the fresh paint
  (walkable 63,480 -> 79,072).
- The same room contains a raised ledge (lighter slab) that colour calls floor and the game calls
  wall; Toriel stands on top of it and re-opens "* There is another puzzle in this room. . ." while
  I am inside her trigger zone. The room's identity is **still unconfirmed** - no sign has been read.
- **Toriel follows and leads.** After I walked away from the channel room she was beside me in the statue
  room, then in the ledge room, and she was facing east just before the view scrolled east. The earlier
  note "she stands on the block and is a permanent gate" is wrong: her occupying the block's one walkable
  row is a state, not a fixture, so the channel can be re-tested once she is out of it.
- Her line `* There is another puzzle in this room. I wonder if you can solve it` re-fires on entry while
  I am inside her trigger zone - it fired again in the ledge room, which has no channel at all. It is not
  a room signature and must not be used to identify one.
- The channel has **no east bank**: the corridor logged as its east side is the same west corridor seen
  after a camera scroll.
- The grey wall plaque sits in the wall band; my "no text from it" readings were taken while facing away
  or ~245 px off. It has never been read from true adjacency.
- Untested probes, in priority order: step into the water (the solid claim is colour-only); push the block
  while standing in its one walkable row (both earlier pushes pressed its non-walkable faces); lure
  Toriel off the block and re-enter that row; read the plaque and the arrow decal from proper adjacency.

## Next actions
1. After the frontier walk ends: `slam probe`, then take a shot and read it - the walker has moved me and
   the grid only means anything inside the current `init` generation.
2. Read the ledge-room plaque from true adjacency (stand under it, face it, `z`, then `z` again, then MOVE)
   and zoom the yellow arrow decal - the only in-game instruction I have not actually decoded.
3. In the channel room run the two physical probes: water walkability from the block's row, and a push
   while standing in that same row. Commit a shot of each result to `evidence/run1/`.
4. Follow Toriel when she leads - she is the only route hint the game itself offers, and she has now been
   seen walking ahead rather than waiting.
5. Save at each save point; record the room name it shows. Fill `ENDINGS.md` as endings are reached.
6. Keep the pause contract: commit+push every change, re-anchor the grid (`slam init`) before stopping, and
   leave `HANDOFF.md` pointing at the real position so another session can resume cold.

## Known technical limits
- The OCR vocab is trained only from text I have already read on screen, so
  unfamiliar words show as `?`; each unknown glyph gets trained the first time I
  see the line clearly.
- The dialog watcher needs the box to be visually settled; during room fades or
  fast auto-typing it waits for two identical ink hashes.
- `dodge` sees only blobs inside the battle box; pellets outside the ring are
  invisible to it until they enter.
- Memory inspection (`mem`, `memr`) exists at the operator's request as an
  observation aid. Gameplay decisions still come only from what the screen
  shows; no walkthroughs, no engine data used to plan routes.
- Rebuilding the bridge requires killing the harness (it owns the child and
  exits with it); the game itself is never restarted by tooling.
