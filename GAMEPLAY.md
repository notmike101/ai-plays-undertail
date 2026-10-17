# Gameplay journal

Only information an ordinary player could see on screen, plus my own actions and
results. No engine internals, no outside walkthroughs.

## Session 1 — 2026-10-16

### Title / instruction screen (seen)
- Menu options: `Begin Game`, `Settings`. No "Continue" -> this install has no save yet.
- On-screen controls: `[Z or ENTER] - Confirm`, `[X or SHIFT] - Cancel`,
  `[C or CTRL] - Menu (In-game)`, `[F4] - Fullscreen`, `[Hold ESC] - Quit`.
- On-screen hint: "When HP is 0, you lose."  -> health matters, losing is possible.
- Footer: `UNDERTALE v1.08 (C) TOBY FOX 2015-2017`.

### Actions / results
- Z on `Begin Game` -> "Name the fallen human." letter grid.
- Typing a letter key (tested `D`) does nothing: selection is grid-based.
- Arrow keys move the yellow cursor; Z picks a letter. Down from the last letter
  row enters the bottom row: `Quit`, `Backspace`, `Done`.
- Entered name: **OMPO** (my own choice, not a preset). Chosen name appears above
  the grid; cursor stays on the last picked letter.

### Open questions

### Opening scene (seen)
- After the name is confirmed the screen shows the fallen human lying in a field of
  golden flowers on green grass, ringed by pale light, seen from above. Text: none.
- Pressing keys eventually makes the human stand up (small visual change), then the
  scene sits still again. Early on I mistook small changes for a frozen game.
- Observation method fixed: numeric frame diff (`play.mjs diff`, `watch`, `probe`)
  instead of eyeballing, so small changes are detected.
- Probe of key responses on this scene: see log below (results recorded per key).
- The name-confirmation prompt is `No / Yes`; both sit on the grid's column row, so
  cursor movement is column-based: from `Quit` five `right` presses lines the cursor
  up under `Done`; five more lines it up under `Yes`.
- What "HP" is, how combat works, what the three endings depend on: unknown.
- `Settings` contents: not examined yet.

### First encounter: the flower (run 1)
- Walking right out of the flower field leads into a dark stone corridor; going up
  toward the big carved arch triggers a talking flower with a face.
- Dialogue seen (star-prefixed lines, one per page): "Howdy!", "You're new to the
  UNDERGROUND, aren'tcha?", "Golly, you must be so confused.", "Someone ought to
  teach you how things work down here!", "Here we go!"
- The screen then changes to a lesson layout: the flower top-left with a speech
  bubble, a white square box below it holding a red heart, and a status line
  `LV 1  HP [yellow bar] 20 / 20`.
- Learned from the lesson text: the heart is my SOUL, "the culmination of your
  entire life's purpose"; arrow keys move it inside the box (verified: the heart
  slid left when I held LEFT); "Your SOUL starts off weak, but can grow strong if
  you gain a lot of LV."
- The flower is called "smiley" in my notes; it introduces itself next to the box.
- Mistake: my first dialogue captures were taken mid-typing, so I lost the tail of
  some pages. Fixed by capturing until the frame stops changing (`play.mjs page`).
- Observation bug found and fixed: the game window loses foreground to other
  windows, and then key presses went to the wrong window, which looked like the
  game being frozen. The bridge now pulls the game window to the foreground before
  every key press.

## Current run
- Run 1 (fresh install, first save not reached yet). Entered name came out **HMPO**
  because a stray confirm keypress picked an extra letter before I corrected the
  entry; harmless, name is cosmetic. In the lesson screen with the talking flower.
- Instance note: the first game process was left running when this session started;
  it was replaced by a clean launch from the install directory (that is the instance
  being played now).
