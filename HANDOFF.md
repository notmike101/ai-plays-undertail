# Handoff — Undertale blind playthrough (paused 2026-10-17)

## What this is
A blind playthrough of a locally running Undertale build driven ONLY through screenshots, OCR and
keyboard input. No memory reads of game state, no save-file parsing. Two tools do everything:

- `src/play.mjs` — observation + input. Verbs: `shot n.png`, `text`, `press <key>`, `hold <key> <ms>`,
  `down`, `up`, `seq`. Hold moves ~0.18 px/ms (400 ms ~72 px, 1200 ms ~215 px).
- `src/slam.mjs` — persistent pixel-derived world map + route planner. Verbs: `init`, `mark`, `show`,
  `png`, `walk`, `selftest`, `probe`, `maskdbg`, `clean`, `resync`, `reach`.
  `walk frontier|plank|"to <wx> <wy>" [steps]` (world coords; default 60 steps).
  `reach <wx> <wy>` floods with the planner's own gates and prints the class/THIN/passable/bodyFit of the
  four cells ahead of the closest cell it could reach — the tool for any "no path".
- Helpers: `node tmp_census.mjs [CLASS]` (blob inventory per class), `node tmp_black.mjs <gx> <gy>`,
  `node tmp_gaps.mjs <gx> <gy>`. Grid: 2 px per cell, 1600x1000, origin cell (800,500) = world (0,0);
  `cell = (800 + wx/2, 500 + wy/2)`. Maps: `logs/map/roomN.{bin,json,png}` (gitignored).
- Start everything with `node src/harness.mjs` (it spawns `src/bridge/bridge.exe`, ws://127.0.0.1:8789).
  The harness watches for dialog boxes and appends OCR lines to `logs/dialog.jsonl`.
- `node src/slam.mjs selftest` must stay green; every mapper fix in this repo has a case there.

## Resume right now
The game is live, standing in the octagonal **statue room** (cream dog statue), grid freshly anchored
(`slam init`) at my feet. No walk job is running.

```
node src/slam.mjs probe          # what the grid thinks
node src/play.mjs shot now.png   # then READ now.png - the shot is the authority, `text` lags
```

## Room graph (all walked, verified by foot)
- OCTAGON (signpost, pale plateau) -east corridor-> CORRIDOR (grey plaque) -> EAST CHANNEL ROOM: water
  channel with a brick block in it and SPIKE tiles in the channel's east column. Toriel stands on it.
- OCTAGON -south arch-> STATUE ROOM (dog statue, dims then lights) -north gap-> LEDGE ROOM (camera
  scrolls, raised ledges, plaque, dead-end pocket) -east-> back into the EAST CHANNEL ROOM's west
  corridor. STATUE ROOM -west-> TWIN ROOM = the channel room mirrored (channel on the WEST, decal
  duplicated in mirrored pairs, no spikes seen there).
- Grid caveat: transitions here are often fadeless, so the identity matcher keeps one room id and merges
  rooms into one grid (walk53's grid had two spike fields although the twin has none). Do not trust one
  grid across rooms; re-`init` after hand-driving.

## Puzzle state (the open goal)
The east room's channel: the block is a bridge with **exactly one walkable row** (the middle). The only
way onto the spike column is across that block. Toriel sits in that row, and `walk "to"` and hand
presses both fail there.

Still UNTESTED, and these are the cheap decisive probes:
1. **Is the water walkable?** Every "water is solid" claim came from a colour class, never from a step.
2. **Push the block from the correct row.** Both push attempts pressed its north/south faces, which are
   not walkable rows, so a push could never register. Stand east/west of it IN its middle row, then
   `hold <dir> 1200` and compare the block against a fixed wall in the shot.
3. **Toriel follows the player.** She was beside me in the statue room after I walked away, so she is not
   a static gate: walk off, let her follow, come back, and the block's row may be free.
4. Read the in-world instruction again: the signpost says `* Press [Z] to read signs!`. Grey plaques and
   the yellow arrow decal gave no text when pressed from below, but only from one or two positions; try
   other standable tiles adjacent to them, and zoom the decal (it appears to be a diagram: `-> >> \: v`).
Sign already read (evidence/run1/24_*): `* The western room is the eastern room s blueprint.`
A room NAMEPLATE and any save point have NOT been found yet.

## Hard-won rules (each cost a wrong claim; do not relearn them)
- The **shot is the authority**. `play.mjs text` can report a box that already closed.
- **Camera scroll masquerades as NPC movement.** Compare sprite against a fixed wall inside one frame;
  that is how I wrongly reported Toriel pacing.
- `OTH` blobs on the map can be **my own face pixels** along my trail — I mistook a line of them for
  floor pressure plates.
- A 3-row brick block has one walkable row; pressing its north/south face stops dead and looks like a
  wall. That produced a retracted "the block is not walkable" claim.
- A signpost re-opens while you stand facing it: press `z` (twice for two pages) then MOVE, do not press
  `z` again.
- A hold that ends is not a wall; re-hold before concluding "blocked".
- Hand-driving invalidates the grid: run `slam init` afterwards. Never touch the game while a `walk` job
  is running (`write proc://<id>/kill` stops one).

## Evidence index
`evidence/run1/`: 24 blueprint sign, 25 me standing on the block, 26 the `[Z]` signpost, 27 the spike
column, 28 Toriel in the block's row, 29-31 the twin room, 32-33 the one-walkable-row crossing,
34 Toriel static with the spikes beyond. Prose and retractions: `GAMEPLAY.md`; tool design and traps:
`ARCHITECTURE.md`; status by session: `PROGRESS.md`.

## Repo conventions
Commit and push after every change: write `cm.txt` (gitignored, never `git add cm.txt`) then
`git add <paths> && git commit -F cm.txt && git push origin HEAD`; `git status --porcelain` must come
back clean. Never `git commit -m`.
