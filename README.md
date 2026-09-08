# Neon District: Street Run

An original open-world driving game that runs in the browser. Walk a compact
coastal city at dusk, steal a car, run three jobs, pick up police heat and shake
it before they box you in.

Built with React, TypeScript, Three.js (React Three Fiber), Rapier physics and
Zustand. No external art or audio assets — every model is built from primitives
and every sound is synthesised with the Web Audio API.

> This is an original work. It is not affiliated with, endorsed by, or derived
> from any existing game franchise, and contains no third-party game assets.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

```bash
npm run build        # type-check + production build to dist/
npm run preview      # serve the production build
npm test             # unit tests (Vitest)
npm run typecheck    # tsc -b
npm run lint         # oxlint
node scripts/verify.mjs   # end-to-end gameplay checks in a real browser
```

`scripts/verify.mjs` needs the dev server running and drives Google Chrome
through `playwright-core` (it uses your installed Chrome — nothing is
downloaded).

## Controls

| Input  | Action                                     |
| ------ | ------------------------------------------ |
| W A S D| Move on foot / accelerate, brake, steer     |
| Mouse  | Look around                                |
| Shift  | Sprint on foot                             |
| Space  | Jump on foot / handbrake while driving     |
| E      | Enter or exit a vehicle, start a mission   |
| R      | Recover a stuck or flipped vehicle         |
| M      | Toggle the expanded map                    |
| H      | Toggle the controls list                   |
| Esc    | Pause                                      |

Click the canvas to capture the mouse. Pausing releases it; if the pointer is
released unexpectedly the game pauses cleanly rather than half-listening.

## The first minute

You spawn on the sidewalk outside the safehouse in the north-west corner. A
Kestrel Civic is parked a few metres to your right — walk up, press **E**, and
the mission marker for *First Delivery* is on the same stretch of pavement.

## What is in the game

**World.** A seeded 500 m city on a 6×6 block grid: a connected road network
with a continuous outer loop, 49 intersections, sidewalks, a commercial core of
tall towers, residential and industrial districts, a park, a plaza, a
safehouse, and a garage. Buildings are placed inside block interiors by
construction, so they can never obstruct a road, spawn or marker (there is a
test for this). A lit sea wall marks the world boundary.

**On foot.** Camera-relative movement on a Rapier kinematic character
controller, with sprint, a single jump with real ground detection, wall
sliding, and a fall-out-of-world reset. Diagonal movement is normalised, and
all motion is frame-rate independent.

**Driving.** Three visually and mechanically distinct vehicles — compact,
sports, police. Arcade handling on dynamic rigid bodies driven purely by
impulses inside Rapier's own fixed step: speed-sensitive steering, brakes that
become reverse only below a threshold, a handbrake that lets the car slide,
drag and rolling resistance, per-vehicle condition, and an **R** recovery for
flips. Exiting tests four positions around the car and tells you when they are
all blocked.

**Traffic and pedestrians.** Civilian cars follow road-graph routes in the
right-hand lane, slow for whatever is ahead, and recover if they beach
themselves. Pedestrians walk sidewalk waypoints, pause, and scatter from fast
cars. Both throttle down to 6 Hz updates beyond 120 m, and both shrink in low
quality mode.

**Wanted system.** Zero to three stars. Stealing a parked car is one star;
ramming a patrol car or driving recklessly during a chase adds more, rate
limited so contact cannot escalate every frame. Police route with A* over the
road graph, spawn out of view on distinct nodes, and move between pursue,
search and disengage. Detection needs both range **and** line of sight — sight
lines are sampled against building footprints, so breaking one behind a block
actually buys you time. Stay unseen for 12 s and a star drops. An arrest needs
a unit to hold station on a slow player for four seconds, not merely to drive
past; it respawns you at the safehouse, clears heat, fails the active job and
takes a $250 bail that can never push you negative.

**Missions.** Three data-driven jobs sharing one manager: *First Delivery*
(drive to a pickup, stop in the zone, run it to the docks in time), *Checkpoint
Run* (six ordered gates against a clock, only the live gate highlighted), and
*Lose the Heat* (start at two stars, shake the search, get home). Rewards pay
exactly once, failures stay retryable, and timers stop when you pause.

**Interface.** Health, cash, wanted stars, active objective, mission clock,
speedometer and vehicle condition, interaction prompts and event notifications.
The minimap and the full-screen map are drawn from the same `WorldData` the 3D
city is built from, through one shared coordinate conversion, so they can never
disagree with the world.

**Saving.** Versioned `localStorage` holding cash, completed jobs, audio and
quality settings and a safe resume position, written at meaningful moments
rather than per frame. Malformed or outdated saves degrade to "no save" instead
of throwing.

## Architecture notes

React composes the scene and owns coarse state (`src/game/store.ts`, Zustand).
Nothing per-frame goes through React: transforms, physics, AI and the camera
run in `useFrame` / `useBeforePhysicsStep` against refs and a plain mutable
`minimapBridge` object.

```
src/game/
  config.ts          all tunable values
  world.ts           seeded city generation
  navigation.ts      road graph, A*, lane helpers
  Simulation.tsx     the frame loop and control-state machine
  Player.tsx         kinematic character controller
  Vehicle.tsx        vehicle registry + component
  vehiclePhysics.ts  arcade handling model
  CameraRig.tsx      third-person camera with boom collision
  systems/           traffic, pedestrians, police
  missions.ts        mission data + pure state machine
  wanted.ts          heat escalation, decay, arrest
  save.ts            versioned persistence
  audio.ts           procedural Web Audio
src/ui/              HUD, menus, minimap
```

Vehicle dynamics run inside Rapier's fixed step so the solver sees exactly one
set of impulses per iteration. Mission, wanted and save logic are pure
functions kept out of the render tree, which is what makes them directly
testable.

## Verification performed

All results below were measured on this machine (Windows 11, Chrome, 1280×800),
not estimated.

**Automated:** `npm test` — 64 unit tests pass, covering mission transitions and
one-time rewards, wanted escalation cooldowns/decay/arrest, save validation
against corrupt and stale payloads, world-to-minimap conversion, A* routing,
and the invariant that no building overlaps a road or spawn point.

`npm run build` and `npm run typecheck` pass clean. `npm run lint` reports 9
warnings, all fast-refresh hints and intentional ref-mirror patterns.

**End-to-end:** `node scripts/verify.mjs` drives the real game in Chrome and
passes **51/51** checks, including: New Game starts; walking, sprinting and
jumping move the character the expected distances; diagonal movement is not
faster; the player is stopped by a building wall; entering and exiting a
vehicle works repeatedly; the car accelerates and drives (32.5 m in 2.6 s); R
rights a flipped car; police spawn, close from 37 m to 16 m, and heat decays to
zero once sight is broken; all three missions complete and pay once; a mission
fails on timeout and stays retryable; Escape freezes both motion and the
mission clock; Continue restores cash and completed jobs; a corrupt save falls
back to the menu; the interface stays readable at 1024×640, 1366×768 and
1920×1080; and the console stays clean.

**Performance:** 59–85 FPS measured over 5-second samples at 1280×800 on high
quality with full traffic and pedestrian budgets. This is one laptop with one
GPU — treat it as a data point, not a guarantee.

Screenshots from the run are in `verify-shots/`.

## Known limitations

- **Buildings are exterior only.** There are no interiors to enter.
- **Police detection is a sampled sight line, not a physics raycast.** It tests
  building footprints only, so a very low wall or a parked car will not conceal
  you. It is deliberately cheap and runs every frame per unit.
- **Collision damage is inferred from sudden speed loss** rather than read from
  Rapier's contact-force events. It is stable and never false-fires on braking,
  but the magnitude is an approximation.
- **Traffic does not obey signals.** Intersections are handled by
  slow-for-what-is-ahead plus lane offsets; there are no traffic lights or
  right-of-way rules, so occasional bumping happens.
- **The JS bundle is ~3.4 MB (1.17 MB gzipped)**, dominated by Three.js and the
  Rapier WASM. It is not code-split.
- **Desktop keyboard and mouse only.** There are no touch controls.
- **No postprocessing.** Bloom was left out deliberately in favour of a stable
  frame rate and a readable image.
