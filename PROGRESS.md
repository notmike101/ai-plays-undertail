# Progress

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

## Next actions
1. Walk out of the plank room through the doorway behind me - the reachability flood now
   targets cell 800,596 there, a 432-cell route the old frontier list could not see - and
   confirm the signature match reuses the room I already mapped instead of minting a new
   number. Then look for the unexplored exits of the earlier rooms.
2. Keep reading every page: the watcher logs all of them; check
   `tail -1 logs/dialog.jsonl` after each confirm press.
3. Save at each save point; record the room name it shows.
4. Fill `ENDINGS.md` as endings are actually reached; keep `evidence/run1/` current.

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
