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

### The flower's attack and the rescue (run 1)
- The lesson turned hostile: "What's LV stand for? Why, LOVE, of course!", "Down here,
  LOVE is shared through little white 'friendliness pellets'. Are you ready?", then
  "Die.", "Kill or BE killed.", "Why would ANYONE pass up an opportunity like this!?"
- Pellets are small white blobs; they surround the box in a ring and the flower grins.
- Result: my HP fell from 20/20 to 1/20. Cause was mine: I kept pressing the advance
  key while the pellets were hitting me, and I never moved the SOUL during the attack.
- Then TORIEL appears — "I am TORIEL, caretaker of the RUINS." — and my HP is back to
  20/20, so something healed me during/after her arrival.
- Her lines so far: "I pass through this place every day to see if anyone has fallen
  down.", "You are the first human to come here in a long time.", "Come! I will guide
  you through the catacombs."
- Vocabulary learned: the world is the UNDERGROUND; this area is the RUINS; monsters
  have LV and LOVE; HP is health, 0 HP = lose.
- Rule I set for myself: before advancing any dialogue during an attack, run the dodge
  loop first; never tap the advance key while white blobs are on screen.
- Evidence saved in evidence/run1/ (frames 01-07).

## Current run
- Run 1, name **HMPO** (a stray confirm keypress added an extra letter; cosmetic).
- Standing with Toriel after the rescue. LV 1, HP 20/20. No save point seen yet.
- Instance note: the pre-existing game process was replaced by a clean launch from the
  install directory; that instance is the one being played.
