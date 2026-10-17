# Architecture

Engineering notes only. This file must never be used to answer gameplay questions.

## Data flow

```
UNDERTALE.exe (original install, untouched)
      ^  window pixels (PrintWindow / CopyFromScreen)
      |  keyboard events (SendInput, VK)
src/bridge/bridge.exe      native bridge, C#/.NET 4, line protocol on stdin/stdout
src/harness.mjs            Node sidecar: owns bridge child, ws server on 127.0.0.1:8789
src/play.mjs               structured stdio CLI used by the operator
```

`ws` is vendored offline into `node_modules/` from an existing local install
(C:\Users\me\pi-web-interface\node_modules\ws). No network use.

## Bridge commands (stdin line -> one JSON line)

`ping | list | find | fg | focus | hwnd <n> | filter pid=<n> title=<t> substr=1|0 |
 shot <path> [blt] | key <name> <press|down|up> [scan] [holdms] | held | quit`

- Default window match: title exactly `UNDERTALE`. `filter` narrows by pid.
- Capture default is `PrintWindow(PW_RENDERFULLCONTENT)`; works for this D3D9 game.
  `blt` grabs the screen rectangle instead (needs an unobstructed window).
- `key` name table lives in `Vk()`; `scan` switches to scancode input.

## Engine facts observed while building the interface

- GameMaker-style windowed client area 640x480, window 646x520, ~30 fps.
- Instant down+up taps are dropped by the game's input polling. A hold of
  ~90 ms registers; harness default hold for `press` is 90 ms.
- Input must target the foreground window: run `focus` before acting if another
  app has stolen focus.

## Restart recipe

```
taskkill -PID <node harness pid> -T -F          # harness
"C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe" -nologo ^
  "-out:src\\bridge\\bridge.exe" "@build.rsp"   # bridge (build.rsp holds source paths)
node src/harness.mjs                            # sidecar
```

## Known gaps

- No text OCR: frames are read visually by the operator.
- No frame-to-frame diff metric yet; add when combat needs it.
- Bridge restart requires killing the harness (file lock on bridge.exe).
