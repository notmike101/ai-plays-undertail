# Minimal harness for playing Undertale with ordinary keyboard input and
# window-pixel observation. Node sidecar (ws) + native bridge (C#/Win32).
#
#   1. start the game (original install dir as cwd):
#        powershell -Command "Start-Process 'C:\Games\steam\steamapps\common\Undertale\UNDERTALE.exe' -WorkingDirectory 'C:\Games\steam\steamapps\common\Undertale'"
#   2. start the harness (spawns src/bridge/bridge.exe):
#        node src/harness.mjs
#   3. drive it:
#        node src/play.mjs find
#        node src/play.mjs shot [name]        # PNG in logs/frames/
#        node src/play.mjs press z [holdms]   # Z = confirm, X = cancel, arrows = move
#        node src/play.mjs hold left 400
#        node src/play.mjs seq '[{"key":"down"},{"key":"z"},{"shot":"after.png"}]'
#
# Offline dependency: `ws` is vendored from a local install into node_modules/
# (no network). See package.json.
