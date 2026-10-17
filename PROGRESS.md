# Progress

## Status (2026-10-16, session 1)
- Harness loop works end to end: launch/attach -> capture -> input -> capture -> verify.
  - `src/bridge/bridge.exe` (PrintWindow capture, SendInput keys, window focus fix,
    pixel diff, battle `scan`)
  - `src/harness.mjs` (Node + `ws` sidecar, ws://127.0.0.1:8789)
  - `src/play.mjs` (stdio interface: shot/press/hold/seq/page/probe/watch/diff/scan/dodge)
- Live game: UNDERTALE.exe v1.08, my own launch from the install dir (pid 47544 at the
  time of writing), windowed 640x480 client.
- Evidence for the opening sequence is in `evidence/run1/`.

## In-game situation (run 1)
- Name HMPO, LV 1, HP 20/20. Talking flower attacked me (HP dropped to 1/20), then
  Toriel (caretaker of the RUINS) appeared and my HP was restored to 20/20.
- She offered to guide me through the catacombs; dialogue was just finishing.

## Next actions
1. Finish Toriel's dialogue, then follow her with the arrow keys.
2. Look for a save point and learn saving; watch for puzzles/traps.
3. If another attack starts: run `node src/play.mjs dodge <secs>` BEFORE advancing text.

## Known technical limits
- No OCR; the operator reads PNG frames (`page` waits for text to stop typing).
- `dodge` sees only blobs inside the battle box; pellets outside the ring are invisible
  to it until they enter.
- Bridge rebuild requires killing the harness (file lock); see ARCHITECTURE.md.
