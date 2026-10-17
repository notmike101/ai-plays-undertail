# Progress

## Status (2026-10-16, session 1)
- Harness works: launch/attach -> capture -> input -> capture -> verify.
  - `src/bridge/bridge.exe` (C#/Win32: PrintWindow capture, SendInput keys)
  - `src/harness.mjs` (Node + `ws` sidecar, ws://127.0.0.1:8789)
  - `src/play.mjs` (stdio command interface used by the operator)
- Live game: UNDERTALE.exe v1.08, windowed 640x480 client, title `UNDERTALE`.
  Instance pid 51168 was already running from the original install when the
  session began; all later starts go through the documented launch command.

## In-game situation
- Run 1: name entry finished as **OMPO**, name confirmed -> story beginning.
- No save existed before this session ("Begin Game" only, no "Continue").

## Next action
- Continue the opening sequence: observe, advance dialogue with Z, learn movement
  with arrow keys, log first mechanics (HP, "Menu" on C).

## Known technical limits
- No OCR / text extraction; the operator reads captured PNG frames.
- No frame diff metric yet.
- Keys need >=~90 ms hold; harness default press hold 90 ms.
- Game window must be foreground: run `node src/play.mjs focus` first.
