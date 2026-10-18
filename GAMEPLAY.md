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
- The rest of the "circling" was my map lying to the route planner, five times over, and each
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
  5. My position advanced twice as fast as I walked. Over flat floor the pixel cost is flat
     at every offset, so the tie-break toward the commanded shift won even when the camera had
     clamped at a room edge and only my sprite moved - the scenery shift and my screen motion
     were both counted. Proof was a ruler, not a test: the two vine columns on the wall are
     205 px apart on screen and came out 410 px apart on the map. `align` now takes my screen
     motion as a constraint - scenery shift plus screen motion is how far I travelled, and a
     key hold cannot exceed the speed model, which I re-measured against the frame (a vine
     patch slid 588 -> 264 px over 1800 ms of held key = 0.183 px per ms, so 0.18 holds).
- Still open: two real rooms got stitched into one grid, because entering the flat pale-blob
  room produced no dark fade frame I happened to sample, and a featureless room keeps the
  mean-pixel test below threshold. The map showed it: one 2000 px band with a doorway arch in
  the middle. Next check, with the scale fixed: whether the paint contradicts the grid at the
  crossing (floor where the old room had a wall), which would be a detector that needs no fade.
- Method note to self: when the walker claims a room is finished, or a map merely looks
  plausible, measure something - the reachability count (`slam probe`), or one known distance
  in the frame against the same distance on the grid. Every one of these bugs was invisible in
  the code and obvious in a measurement.

### My key presses were going nowhere, and a message box blinded the mapper (run 1)
- `src/play.mjs` has no bare-key verb: input is `press <key>`, `hold <key> <ms>`, `down`, `up`,
  `seq`. Every "I pressed z / enter and nothing happened" earlier in this journal ran
  `play.mjs z`, which answers `unknown cmd` and sends nothing. Those observations are VOID and
  need re-testing: the dummy being "no longer interactable", "`z` and `enter` appended nothing"
  beside Toriel, and the cream figure being "inert" in the brick-gate room.
- Re-tested with `press z`: the box advanced and Toriel had already been talking -
  "* There is another puzzle in this room. . ." then "* I wonder if you can solve it" - the same
  pair she gave in the maze room, offered again when I came back near her. She stands in the room
  and speaks; the earlier "she never spoke, she is a static obstacle" reading is not supported.
- That box is also why the mapper died: a message box covers my sprite, so the walk's frame had
  no player and it quit with "player not found". `clearBox` now OCRs the box, prints the line into
  the walk log, advances it with `press z`, and resumes walking.
- The way out of a room I had completely painted is drawn as a **black notch** in the wall, the
  same class as a pit, and my body-clearance rule refused to path within 3 cells of black. So no
  cell near any exit was routable: `probe` reported 34k walkable cells, 28k routable and "next
  frontier none" in a room whose outline was untouched. Black no longer counts as solid for
  pathing (it is still not standable), unexplored black is a frontier target, and the walker
  presses into it - a failed step paints the wall, a good step goes through the doorway.
- Room 0's grid was discarded (`slam init`): after the box, my recorded position disagreed with
  the frame - slam expected my sprite at screen y 188, the frame had it at ~370 - so the painted
  room could not be trusted.

### My own footprints contradicted the map, and the footprints won (run 1)
- The colour legend failed a third time, and this time the contradicting evidence was my own body.
  Of 828 recorded footfalls in the room I have been mapping, **68 landed on cells the map called
  raised brick wall and 117 on cells it called black pit** - 22 % of everywhere I had actually
  stood. `probe` then reported **2 cells routable from my own position**, in a room I had just
  walked 300 steps across.
- Why: this room draws walkable floor with a *flat* brick-and-seam texture - mortar lines and 1-2 px
  black seams inside ground I can stand on. `paint`'s mortar test (>= 14 of the 3x3 neighbourhood)
  cannot separate that from a raised wall, and `classify` has no way to tell a floor seam from a pit.
  `maskdbg` on the live frame shows it plainly, the raw class row through my own position:
  `1111b11311119999...` - floor, 2 px brick line, floor, 2 px black line, repeating, with me at the
  middle of it (player anchor 107,259).
- Rule now in the mapper: **physical evidence outranks colour.** A `PROVEN` cell (my collision box
  was there) can never be downgraded to impassable by a repaint; `markBlocked` refuses to wall off
  one; and after every paint the trail is swept, claiming the collision box at every point of every
  segment (repairing only the exact footfall cells was not enough - they land ~13 cells apart, so
  `bodyFit` still had nowhere to step). Effect on room 0: 1262 impassable cells relieved, routable
  from me 2 -> 48149.
- What that does *not* say: the brick band along the top of this room is still a wall. The mortar
  rule stays, walls I never stood on are untouched (the selftest checks exactly that), and where the
  two readings disagree the tiebreaker is the cell I have occupied, not a new colour threshold.

### Standing next to an NPC froze me, and the map kept sending me into a ledge (run 1)
- A message box freezes movement, and my sprite stays visible behind it. Two facts that had to be
  separated: the box is the game talking (so a step that moves 0 px is not a wall - four false
  "recorded walls" were painted at one spot), and the box is dismissed by the confirm key. The
  helper that was supposed to do that returned as soon as a frame showed my sprite, so it had never
  pressed anything; on the live game `press z` advanced "* I wonder if you can solve it" and the
  screen text went empty.
- Toriel re-opens that line while I stand inside her trigger zone, so short escape holds landed back
  inside it and the walk reported "an NPC has me pinned" with every direction at 0 px. Leaving the
  zone takes one long hold (450 ms, ~80 px), away from the direction I was pressing, then the two
  perpendicular directions.
- The lighter slab in this room is a **raised ledge**: colour says floor, the game says wall - my
  body stops dead at its lip, and Toriel stands on top of it (frame evidence, `walk21`).
- The map then wasted most of a walk on it: 41 re-targets pressing right out of cell 1066,820 into
  that lip over 180 steps. Recorded walls are not erased by repaints, so this was replanning, not
  forgetting - every new route re-entered the same obstacle from the same side. A move that fails
  three times is now vetoed out of the routing graph for the rest of the walk, and the veto is
  stored with the room.
- The mapper does cross doorways: at step 22 of one walk the screen faded and the matcher answered
  "that is room 0 again (119 landmarks line up)" - the first transition + identity pair confirmed
  on the live game rather than in a test.

### The channel room's puzzle is a spike field, and its bridge is a brick block (run 1)
- One north-south water channel, crossed by a single brick block mid-channel: walkable, proven by
  footfalls (`evidence/run1/25_*`). Colour had it painted solid, which is why routed crossings of
  that channel kept failing while walking them never did.
- East of that bridge the whole passage is spike tiles, and Toriel stands beside it with
  "* There is another puzzle in this room. . ." / "* I wonder if you can solve it"
  (`evidence/run1/27_*`). The corridor west of her dead-ends against a raised ledge, and her body
  blocks the one row that reaches the bridge, so the crossing waits on her moving.
- Signs: a floor signpost re-opens while I stand facing it, so the reading move is `press z` (twice
  for a two-page sign) and then walk away without pressing again. Grey wall plaques give no text from
  the floor - decorative. The cream dog statue in the octagonal room is non-interactive: three `z` at
  contact, nothing.
- Some room pairs here change with no fade. The walk logged a fade and then "that is room 0 again
  (117 landmarks line up)", and walking north out of the statue room entered a Toriel room with no
  dark frame at all. The identity matcher still needs the paint-contradicts-grid test; unfixed.

### I finally talked to her instead of shoving her, and the room told me what it is (run 1)
- Her whole script, from `logs/dialog.jsonl`: "* There is another puzzle in this room. . ." then
  "* I wonder if you can solve it". Proximity-triggered, repeated on every approach, and it is the
  complete set - she never offers anything else and never promises to act, so there is no follow-up
  behaviour to wait for.
- What she does instead: she stands on the brick block's **only walkable row**. The block is three rows
  tall and only the middle one is floor; she is in it, and she only turns to face me, then to face the
  spikes. 1200 ms of held `right` moved neither her nor the block, so the block is not pushable from
  this side - the tile a push would need is the one she occupies
  (`evidence/run1/28_toriel_stands_in_the_bridges_only_walkable_row.png`).
- Her line says the *room* has another puzzle, and the room's other furniture is the four mirrored
  yellow arrow plates plus the sign "* The western room is the eastern room s blueprint." - that points
  at the twin room, where a block sits between two channels with nothing standing on it. Pushing is
  testable there, not here.

### The western room is the eastern room's blueprint, literally (run 1)
- The octagon's **south arch** leads into the octagonal statue room, and that room's west edge (grey
  step tiles) leads into a third puzzle room: the channel room mirrored - water channel on the WEST,
  same brick block in it, same vine columns, and the yellow arrow decal repeated in two mirrored pairs
  (`evidence/run1/29_*`, `evidence/run1/31_*`). The sign is literal.
- The block is a bridge with **exactly one walkable row**, the middle one. My first probe pressed
  against its north face and stopped, which I recorded as "not walkable" (`evidence/run1/30_*`) - that
  reading was wrong: standing in the middle row puts me on the brick, and walking east steps off onto
  the far bank (`evidence/run1/32_*`, `evidence/run1/33_*`). The same one-row rule is why Toriel's body
  seals the eastern room's crossing completely: she is standing in that row.
- The arrow decal and its two yellow plates are not readable either: `z` from the floor directly under
  them gives nothing, like the grey wall plaques. They are painted hint art.
- VOID: "the block is not pushable in either room." Both push attempts were made while I stood against its
  north or south face, which is not the block's walkable row, so a push could never register. The push is
  untested from the row that actually touches it.
- There is **no east bank** to the channel: the corridor I earlier called "the channel room's east side"
  is the same west corridor seen after a camera scroll. The spike field is therefore only enterable by
  walking the brick block. At the time Toriel occupied that block's one walkable row, and `z` at 25 px on
  the same row produced no box (`evidence/run1/27_*`, `p1/p3` frames).
  The spike tiles are still untested underfoot because they were unreachable at that moment, not because
  they were ruled solid. She is **not stationary** - see the next entry - so that row is a state to break.
- Map caution: the yellow `OTH` blobs that looked like floor pressure plates were **my own face pixels**
  painted along my trail. The only yellow art is the wall-band decal, which is not readable.
- She **follows and leads**. When I left the channel room and walked through the octagon into the statue
  room, she was right beside me there, and then in the ledge room; once she was facing east a moment before
  the view scrolled east. Standing next to her for 24 s and seeing no movement is not evidence that she
  never moves - it is evidence that she waits while I am inside her trigger zone. The honest reading: she
  shadows the player and walks ahead, the way the game's own guide does.
- Her hint `* There is another puzzle in this room. I wonder if you can solve it` fired again in a room with
  no channel in it, so it is not a signature of the puzzle room and cannot be used to name one.
- The grey wall plaque has never been read from true adjacency: my `z` presses there were taken while
  facing away or about 245 px off. "Plaques have no text" is therefore still unproven.

### The floor star is the save point, and it names the room I am standing in (run 1)
- Standing at the north edge of the leaf-bordered square and facing north, `z` produced
  `* ( The shadow of the ruins / looms above, filling you with / determination. )` then
  `* ( HP fully restored. )`; `z` again opened the save menu, which printed the location and saved:
  `Ruins Entrance` / `File saved.` (`evidence/run1/35_save_point_names_this_room_ruins_entrance.png`).
- So the room with the octagonal **pale plateau**, the two pale **stair fans**, the **red hedge block**
  in the middle and the **leaf-bordered square** on the floor IS the **"Ruins - Entrance"** room - the
  same save point found in session 1. `evidence/run1/36_ruins_entrance_room_leaf_square_hedge_plateau.png`.
- That settles where the save reload left me: at that save point. Everything mapped earlier (octagon,
  corridor, channel, statue, ledge, twin rooms) is **ahead** of me on this run, not behind it, so this
  run has to walk the route again rather than resume inside it.
- The save point is a flat yellow four-point star painted on the floor. It is only interactive from
  adjacency **while facing it**: the first `z` (facing south, away from it) produced nothing; facing
  north gave the flavour text. "No text from a floor marking" is a facing/distance claim, not a property
  of the marking - the same mistake that made the grey plaques look unreadable.
- This is the first NAMEPLATE-shaped fact of the run: a save point is what names a room here. No
  standalone room sign has been seen anywhere yet.

### The game instance changed under me and the map believed it (run 1)
- A 200-step frontier walk pinned itself to one cell for 25 steps, every step reporting `moved 0px` and
  `foreground was not the game window -> already foreground: 0x67716`. Cause: UNDERTALE.exe is now
  **pid 1332 / window 0x67716**; the instance I had been driving (pid 12320 / window 0x5505054) was
  closed when the save was reloaded. The bridge kept capturing the dead window, so the frames were
  byte-identical and the walk recorded walls at my feet.
- VOID: every "0 px move" from that walk (steps 1-27, ~7 recorded walls around cell 1010,644). The grid
  generation was discarded with `slam init`.
- Rule this installs: identity of the target window is part of the observation. `play.mjs find`
  (hwnd + pid) has to match what was captured last before any zero-move may be called a wall; a
  foreground that belongs to a *different* window than the capture window means the loop is severed,
  not that geography is.

### Two rooms west and north of the entrance: a faced door, six stones, and a switch sign (run 1)
- The **pale stair fans climb**. Standing on the east fan and holding up moved me onto the octagonal
  plateau (measured 43 px then 31 px, then a stop at the plateau's north edge). Nothing about the
  stairs' colour predicted that; only walking did.
- In the plateau's north wall, above a black doorway, a grey plaque: `z` from the tile directly under
  it produced **no text**, and zoomed 12x the plaque is a **dither pattern of uniform dark blocks** -
  no strokes, no widths, no ascenders. Not text. (Grey plaques elsewhere stay unproven, but this one
  is now tested from true adjacency.)
- Going through that doorway changed rooms and put **Toriel** in front of me:
  `* Welcome to your new home, innocent one.` then
  `* Allow me to educate you in the operation of the RUINS.` (`evidence/run1/37_*`).
- That room has a **giant closed magenta door with a face** (two angled eyes, a nose, a mouth) in its
  north wall, six **grey stones set in a ring**, a grey plaque on the brick band, and a yellow `[Z]`
  sign. After Toriel's lines the faced door was **open** - a black opening where the face had been
  (`evidence/run1/38_*`). I pressed nothing at it: she opens doors.
- The `[Z]` sign, read from true adjacency, three pages:
  `* Ancient fusions between diversions and doorkeys.` /
  `* One must solve them to move from room to room.` /
  `* Please adjust yourself to the sight of the ...` (the third page was never captured whole: the
  dialog log ring truncated it and my `z` closed the box before the line finished typing).
- Walking west out of that room - I did not notice the fade, only that the next frame was a different
  room - put me somewhere with **vines on the north wall, a water channel crossed by one brick plank
  on the east**, Toriel, and a grey sign on a post. Its two pages are the first puzzle instruction of
  the run: `* To make progress here, you will need to trigger several switches.` /
  `* Do not worry, I have labelled the ones that you need to flip.` (`evidence/run1/40_*`). The `'`
  in the OCR is a comma; `ad?ust` is an untrained `j` glyph.
- Working hypothesis, held as a hypothesis: the six stones in the ring are the labelled switches.
  Nothing yet links them to the channel room, and I have read no label on any stone.
- Caution earned: a **room change happened between two of my key presses** and only the following
  frame revealed it. The eye does not track rooms; the identity matcher has to.
### The six stones are not switches and not obstacles - I walked through them (run 1)
- Hypothesis retracted: the six grey stones in the ring room are **floor decals**. Holding right from
  feet x 412 travelled 412 -> 454 -> 490 -> 526, straight across the drawn bodies of three of them,
  and what finally stopped me was the room's **east wall** at x 538. My drawn body (34 px wide) also
  overlaps a stone's drawn box while standing beside it. The drawn sprite is not the collider.
- They are **unlabelled** at 6x too: flat grey cobbles with a maroon top edge and a black drop shadow,
  no strokes anywhere on them. So the "labelled switches" the sign promises are still unidentified,
  and the ring is scenery.
- What this rules out matters for the puzzle: the switches are not the obvious objects in this room.
  Remaining candidates from what I have actually seen: the plank over the channel in the vine room,
  the grey plaques, and whatever is behind the faced door (never entered).
- General rule this earns, and it is now enforced in the mapper rather than in my attention: **a colour
  may call a cell unknown, never solid.** Only a step that physically failed may call a cell a wall.
  Every "solid" claim in this run that was based on colour alone has since been contradicted by walking
  - the leaf block, the channel water, and now these stones.

### The room east of the ring: two channels, three yellow plaques, and Toriel is solid (run 1)
- Shape, measured instead of eyeballed. Walking south 200 px moved Chara from screen y 240 to y 440 while
  every piece of scenery kept its exact pixel position, so **this room is one screen tall and the camera
  never scrolls vertically**. Walking west it scrolled 117 px and then clamped. The walkable band is about
  **510 px wide by 300 px tall**; the south-west corner is walled off by a black L-shaped edge (`43_`).
- In that band: **two water channels crossed by brick planks ~420 px apart**, each channel with a **framed
  black water outlet at its north head**, three vines on the north brick wall, and a grey plaque low on the
  west edge (`46_`). The shape claim is `45_`: after 200 px of southward walking I am standing against the
  bottom wall with the switch still at the same screen height - the camera has not moved at all.

- Two different plaque texts, both read at true adjacency: the low west-edge plaque says
  `* Please continue south.` / `- TORIEL`, and the yellow slot-plaque on the north wall says
  `* Please press this switch.` / `- TORIEL` (`41_`).
- **The three yellow "switches" are plaques, not levers.** Each is a yellow frame around a black slot with a
  handle nub inside it, annotated with chalk arrows. Pressing `z` at one printed the same two lines as the
  wall plaque, and the handle **did not move**: the 10x crop of `300,130-350,180` before and after the press
  is pixel-identical (`44_`). There is no mechanism in this room.
- **RETRACTION (mine, this session):** I first reported "a room with three labelled switches, a stone-tiled
  floor, and a lever whose handle sits in the middle". All three parts were wrong: the floor plates are flat
  grey decals (floor, already established for the ring cobbles), the "switches" are note plaques, and the
  "handle in the middle" is a static part of the plaque's drawing.
- **RETRACTION: the plaque line is not a room signature.** South of me in this room is a wall at world y +96,
  so `* Please continue south.` cannot describe it. It is an instruction, and the room it applies to is the
  big ring room, whose southern way out I have still not taken - I turned east at the ring instead. This is
  the first route direction Toriel has given me in words.
- **Toriel is SOLID.** Three nudges (down/right/right) reported 86, 210 and 0 px while consecutive frames
  showed me in the identical pixel position: I was boxed by water east, Toriel standing directly south, wall
  north, and `motion.mjs match 290 200 350 270 60 hold right 900` measured mean |d| **0.0** across the box
  containing my own sprite (`42_`). She does not step aside when I walk into her.
- **The map grid is not trustworthy across a room change.** After `init` here and `walk frontier 500` the
  grid spanned `786..1477 x 341..763` cells at 13.6% mapped with the ring room and this room painted as one
  grid and a smeared seam between them; `walk frontier` then reported "the map looked finished" twice and
  `reach` refused a target the grid calls solid. Until the seam is fixed the map is only used **within** one
  room, and travel between rooms is done by hand with a shot after each leg.
- Evidence (in `evidence/run1/`): 41 the slot-plaque's own text, `Please press this switch`; 42 me boxed
  between water, Toriel and the wall; 43 the two channels, planks and framed outlets; 44 the plaque-lever
  with its handle unmoved after pressing; 45 the south wall with the camera unmoved; 46 the west-edge plaque
  and the black walled-off corner.

### CORRECTION to the section above, same session: this room does have a south exit
- "South of me in this room is a wall" was tested from the room's **east half**. Walking to the west half and
  looking again: the room's west edge is a wall (Chara against it, void beyond), and there is a **pale
  corridor leaving through the bottom edge of the frame** at world x ~+40..+130 - so
  `* Please continue south.` does apply here, and it points at that corridor. The ring-room claim in the
  previous bullet is withdrawn until I stand at the ring and test its south side myself.
