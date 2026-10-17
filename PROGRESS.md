# Progress

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
  My first menu attempt landed on FIGHT; the dummy battle ended "You earned 0 EXP and 0
  gold". The dummy is no longer interactable, so that practice is un-done.
- Maze room: "* There is another puzzle in this room. . ." / "* I wonder if you can
  solve it" from Toriel. Walking out the bottom triggered a **Froggit** encounter; ACT
  -> Compliment gave "* Froggit didn't understand what you said, but was flattered
  anyway.", and the fight closed with "* YOU WON !" / 0 EXP / 0 gold, HP untouched.
  Which action actually closed it is not recorded on screen - noted as a mistake in the
  journal rather than guessed at.
- Now in the plank/water/spike room: a brown plank bridge over water with two blocks of
  spike tiles, a vine wall, an unread wall plaque, and Toriel standing on (and blocking)
  the near end of the plank.
- Full dialogue record: `logs/dialog.jsonl` (copied to `evidence/run1/`).

## Next actions
1. Solve the current room: reach and read the wall plaque, find the safe line past the
   spike tiles, and get past Toriel on the plank.
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
