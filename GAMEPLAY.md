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

### Save point, Toriel's home, the corridor room (run 1)
- Found a save point in the ruins entrance area: examining it shows
  "(The shadow of the ruins / looms above, filling you with / determination.)" and
  "(HP fully restored.)"; pressing Z opens the save menu (`EMPTY LV 0 0:00`,
  `Save` / `Return`), and saving prints "File saved." Location shown: **Ruins -
  Entrance**. I saved there (LV 1, HP 20/20).
- Toriel led me into her home area: a wide room with stone floor buttons and a wall
  plaque; walking on the buttons and pressing Z near them did nothing, and she had
  already gone through the open upper passage.
- Her teaching lines from that room: "Welcome to your new home,", "Allow me to
  educate you in the operation of the RUINS.", "The RUINS are full of puzzles.",
  "Ancient fusions between diversions and doorkeys.", "One must solve them to move
  from room to room.", "Please adjust yourself to the sight of them.", "To make
  progress here, you will need to trigger several switches.", "Do not worry, I have
  labelled the ones that you need to flip."
- Honest gap: while my harness was restarting, several of her pages auto-advanced
  and I never read them. Those lines are lost to me; noted here rather than
  guessed at.

### The labelled-switch puzzle (run 1, solved)
- The room: a long corridor with tall water columns (water above and below a brick
  middle), wall notches, and small yellow tablets on the wall, each ringed by
  blinking yellow arrow marks. Examining a tablet reads: "* Please press this
  switch." signed "TORIEL".
- Wrong guesses I tried and dropped, each checked against the screen: the brick
  sections as floor plates (standing on them changed nothing), the dark recess at
  the top of a waterfall as the switch (Z there did nothing), the corridor's stone
  blocks as an examinable door (no text), walking up the waterfall to a hidden
  passage (walkable, leads nowhere), and a multi-press sequence on a tablet (no
  change anywhere in the room).
- What actually worked: stand in the notch directly under a tablet that carries the
  arrow markings, face it, press Z once. The stone blocks closing the passage at
  the far right of the room moved and the way opened (measured: 2054 changed pixels
  in the gate area; the gate is visibly lower in the next frame).
- Toriel's confirmation, read in full: "* Splendid", "* I am proud of you,
  little one.", "* Go on, press the switch on the left." (she nudged me to the
  labelled tablet when I hesitated), then "* Let us move to the next room."
- Learning: the arrow markings are her labels; plain yellow tablets without them do
  nothing. Pressing must be done standing right at the tablet, facing it.

### Toriel's battle lesson and the training dummy (run 1)
- Her lesson, read page by page: "As a human living in the UNDERGROUND, monsters
  may attack you.", "You will need to be prepared for this situation.", "However,
  worry not / The process is simple.", "When you encounter a monster, you will
  enter a FIGHT.", "While you are in a FIGHT, strike up a friendly conversation.",
  "Stall for time. / I will come to resolve the conflict.", "Practice talking to
  the dummy."
- I examined the dummy: "* Dummy", "* Dummy stands around absentmindedly.",
  "* Dummy looks like it's going to fall over."
- My mistake: a menu selection landed on FIGHT instead of ACT and the attack bar
  started; I let the swing resolve rather than forcing it. Result: "* YOU WON!",
  "* You earned 0 EXP and 0 gold." The dummy gave nothing, so no EXP was taken from
  a monster, but I did strike it against Toriel's instruction to talk. I still owe
  the dummy a proper ACT/talk, which is what she asked for.
- Evidence frames for this stretch: `logs/frames/` (now5, live, dial1, d1, d2, j1,
  k1, k2, m1) and the automatic dialogue log `logs/dialog.jsonl`.

### Reading every page reliably
- The harness now reports dialogue on its own: whenever a text box's ink settles,
  the text is printed and appended to `logs/dialog.jsonl`. Every line quoted above
  came from that log or from a captured page frame, not from memory.

### Froggit encounter (run 1)
- Walking down out of the maze room triggered an encounter: "* Froggit attacks you !",
  then the box showed "* Froggit" with a full green HP bar and my menu
  `FIGHT ACT ITEM MERCY` (FIGHT was highlighted by default, in yellow).
- My first two arrow presses did not register, so FIGHT stayed highlighted; a later
  confirm press went to whatever was highlighted at that moment. I cannot prove from
  the log which action ended the fight, so I am recording that as an unresolved
  mistake rather than pretending I chose ACT first.
- What I did deliberately, following Toriel's "strike up a friendly conversation":
  ACT opened the submenu `* Check / * Compliment / * Threat`; I chose Compliment and
  the game said "* Froggit didn't understand what you said, but was flattered
  anyway."
- End of fight, read from the box: "* YOU WON !" / "* You earned 0 EXP and 0 gold."
  My HP bar stayed full width (20/20) — I took no damage, and no EXP was earned, so no
  monster was killed by me. Froggit is gone from the room.
- No pellet-dodge phase ever started: the bullet box never appeared, so nothing to dodge.

### The plank, water and spike room (in progress)
- The room I am in now: purple maze ledges, a brown plank bridge over light-blue water,
  two blocks of grey spike tiles in the water, a vine-covered wall section, and a small
  plaque on the left wall that I have not been able to reach and read yet.
- Toriel stands on the near end of the plank and blocks it. Pressing the interaction
  key at her produced no dialogue, so the puzzle is mine to work out.
- Measurement problem found and fixed: because the camera follows me, my on-screen
  position stays put mid-room, and my movement tool reported "blocked" for moves that
  actually worked. It now decides from whether the picture scrolled (measured: a wall
  press changes ~3k pixels of my own animation, real walking changes ~77k).
- No yellow switch plates here; the hazard I can see is the spike tiles.


### The plaque riddle and why I cannot cross yet (run 1, in progress)
- I reached the plaque on the left wall and read it: "* The western room is the
  eastern room s blueprint." That is the whole message; a second press gives nothing
  more. It names two rooms, so it is describing the layout of the room east of here.
- My own mistake, now corrected: I had recorded the light-brick floor colour
  (163,73,164) as a raised wall. It is walkable floor - I proved it by standing there
  and sampling the pixel under my feet. The only raised ledge colour is the bright
  (185,98,185) top. So most of what I thought were walls in this room is open floor,
  and I wasted a lot of probing walking into things that were never there.
- What the room actually is (screen measurements): open floor with bright-topped
  ledges; on the east side a light-blue pool; a brown plank bridge standing in the
  pool; a block of grey spike tiles east of the plank; a vine-covered wall to the
  north. The plank's only land-side tile is the one Toriel is standing on. Every
  other approach to the plank is water, void, or a raised ledge - I tested east from
  seven different rows and the walk always stops at the same tile.
- Toriel: pressing the interaction key while standing on her own tile row, facing her,
  produced no text at all (the dialogue log stayed on the plaque line). Watching her
  for 48 s with the robe-colour bounding box showed not one pixel of movement, so she
  is not walking on a timer either. Untested so far: leaving this room and coming back,
  and staying put right next to her for longer.
- Measurement fix worth recording: with the camera following me, neither "did the
  picture change" nor "did my sprite move on screen" can tell walking from a wall
  press. My position is now measured as (my sprite - the plank's brown tiles), which
  survives the camera, and the harness waits 150 ms after a key hold because the
  captured frame lags the key presses (without that wait real moves read as blocked).

### Wandering into the next room, and walking in a loop (run 1)
- I left the plank room by walking west/south and ended up in a neighbouring room: brick
  ledges with bright tops, a long brick wall along the north edge with two vine-covered
  sections, and black pits between the ledges. No water, no plank, no Toriel in view.
- The wall along the north edge has no gap in it: from under it I walked 800 px east and
  the walk simply stopped at the east end, so there is no doorway on that side.
- The south side of that room is a set of very narrow paths - about 17 screen pixels wide,
  while my own sprite's box is about 16 - so entering one needs an alignment of a few
  pixels. One tap of a direction key moves me ~27 px, and holding two keys at once (down
  plus right, both held) did not slide me into the gap either. I stopped there instead of
  forcing it, because nothing in that room asks to be read: no plaque, no NPC, no item.
- My own bookkeeping error, recorded so I do not repeat it: at a room edge the camera
  stops, so my on-screen coordinate freezing can mean "camera clamped" and not "wall".
  Twice I concluded a route was closed from a frozen coordinate alone, then measured the
  pixels at my feet and found an open path somewhere else on the same screen. The rule I
  now follow: never call something a wall from my own screen position - probe the colour
  strip one tile ahead, or look at a fresh frame.
- I clearly walked in a loop: the same dead pocket (my sprite stopped at the same screen
  spot with a bright ledge one tile south) appeared from two different approach
  directions, with 800 px of corridor in between.
- What the coverage walk did establish: one step replaced the whole screen (312 k pixels
  changed at once), which is a room transition, and right after it the brown planks were
  back on screen. So the plank room is reachable from the ledge room; the walk is now
  told to stop as soon as the plank is in view instead of wandering further.
- Still unanswered, and the thing to test next once I am back: whether Toriel moves when
  I leave her room and come back. She blocked the plank, offered no dialogue and did not
  move for 48 s while I watched her.

### My colour legend was wrong again, and how I fixed the method (run 1)
- I had recorded the pale rounded shapes (185,98,185) as raised, un-walkable ledges. While
  positioning with the new mapper I sampled pixels all around my own sprite and got
  (185,98,185) at (300,300), (340,300), (280,300) and (320,340) while I was standing there -
  so that colour is walkable floor drawn in a lighter shade, not a wall. The darker purples
  are floor too. In this art style colour alone cannot tell floor from wall.
- What actually settles it: the tiles I have physically stood on (recorded as PROVEN), the
  hazard colours that are unambiguous (black void, the blue pool, green vines, grey spike
  tiles), and every direction I tried and failed to walk in (recorded as a tested wall).
- Method change, so this does not happen a third time: navigation now runs off a persistent
  picture-based map (`src/slam.mjs`) that matches one capture to the next to get the exact
  camera shift, remembers the room between runs, and plans a route instead of poking at
  directions and hoping. Maps are saved as `logs/map/roomN.png`.

### I was walking in circles because my own map kept cutting its corridors (run 1)
- What the screen showed at the end of that walk: a raised brick wall, a black pit, a blue
  pool with brown planks laid over it, a bed of grey spike tiles, the plaque I read, and
  Toriel standing on the western end of the planks facing me. North of her is water, south of
  her are the spike tiles, and the planks begin on the tile under her feet, so she is not a
  guard I can slip past - she *is* the exit. She never spoke and never walked: six focused
  200 ms right-holds moved my sprite 0 px while a down hold in the same second moved 98 px,
  `z`/`enter` appended nothing to `logs/dialog.jsonl`, and her box held [360,300,390,352]
  over 30 s of sampling.
- The rest of the "circling" was my map lying to the route planner, four times over, and each
  lie was visible in `logs/map/roomN.png` once I looked instead of guessing:
  1. A mid-room step was filed as a room change. The planner scored "did the picture change"
     by the *average* pixel difference; the pool ripples and the spike tiles inflate that
     average on their own, and a camera scroll bigger than the +-12 px search window makes
     every offset look wrong. One mapped room was thrown away this way. A room change now has
     to mismatch *most* samples, and a wide search recovers the scroll.
  2. Coming back through a doorway started a brand new grid (room 4, 5, 6...). I was
     literally re-mapping the same corridor and calling it new. Each room now carries the
     offsets of its scenery relative to the cell under my feet - the one thing the camera
     cannot change - and a matching signature reuses the grid and my landing cell.
  3. The floor tiles are drawn with 1-2 px black seams, and black is what my mapper calls
     VOID, the same label a real pit gets. My own body-size rule refuses to path within 3
     cells of known solid, and the gaps between seams are 6-7 cells, so the seams sliced
     every corridor into sealed pockets: 18.7k routable cells existed, none of them reachable
     from the rest of the room. Seams thinner than 4 cells in either direction are now floor;
     the 16x16 black pit east of the planks survives, which the selftest checks.
  4. The frontier list only looked +-320 cells around me and ranked by straight-line
     distance. The unexplored edge was *behind* me - the side I had already walked away from,
     where the doorway out is - so it was never a candidate, and every candidate it did try
     was on the far side of a brick wall. The walker then announced "nothing left to map" in
     a room with a third of it still blank. One flood over the whole grid now measures how
     far each unexplored cell actually is by walking.
- Method note to self: when the walker claims a room is finished, check the map file and the
  reachability count (`slam probe`), not the feeling. "No path" is a claim about my graph,
  and three of these four bugs were only findable that way.
