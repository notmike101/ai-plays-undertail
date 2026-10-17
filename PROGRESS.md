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
  - Navigation tools (all closed-loop, verified against the screen):
    `src/walk.mjs` (ASCII room map + player position: path / water / brick /
    vine / dark / plate / non-path + `@` for me), `src/move.mjs` (move N px and
    report how far I actually went, flags blocked), `src/align.mjs` (walk under
    the nearest yellow switch plate, step to the wall, face it, press),
    `src/yscan.mjs` (`findPlates`).
  - `src/bridge/build.ps1` - repeatable build (Roslyn csc); a bridge rebuild
    requires stopping the harness first (file lock).
- Live game: UNDERTALE.exe v1.08 (Steam install), windowed 640x480 client,
  launched from the install dir; harness runs as a supervised service.

## In-game situation (run 1)
- Name HMPO, LV 1, HP 20/20, saved at **Ruins - Entrance**.
- Flower fight (HP 1/20) -> rescued by Toriel -> her home area -> **solved the
  labelled-switch puzzle** and opened the stone gate; Toriel: "Splendid / I am
  proud of you, little one."
- Now in the dummy room. Toriel told me to "Practice talking to the dummy"; my
  first menu attempt landed on FIGHT, so the dummy battle ended with 0 EXP / 0
  gold. Still to do: ACT -> Talk on the dummy, then follow Toriel onward.
- Full dialogue record for this stretch: `logs/dialog.jsonl`.

## Next actions
1. Finish the dummy battle the way Toriel said: ACT -> Talk (and never advance
   text before running `dodge` if pellets are on screen).
2. Follow Toriel through the next rooms; read every page from `dialog.jsonl`.
3. Save at each save point; record the room name it shows.
4. Fill `ENDINGS.md` as endings are actually reached; keep `evidence/run1/`
   updated with frames for every claimed milestone.

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
