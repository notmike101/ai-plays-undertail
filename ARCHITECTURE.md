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
src/walk.mjs               ASCII room map + player position from a raw dump
src/move.mjs src/align.mjs closed-loop navigation (measure -> hold -> measure)
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
