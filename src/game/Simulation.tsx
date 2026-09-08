import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import {
  DRIVING,
  MISSION,
  PHYSICS,
  PLAYER,
  TRAFFIC,
  VEHICLE_SPECS,
  WANTED,
} from './config';
import {
  missionById,
  missionDefs,
  parkedVehicles,
  useGame,
  world,
} from './store';
import {
  advanceObjective,
  canStart,
  failMission,
  initialRuntime,
  isObjectiveSatisfied,
  startMission,
  tickTimer,
  type MissionRuntime,
} from './missions';
import {
  addHeat,
  clearWanted,
  desiredUnits,
  initialWanted,
  setStars,
  tickWanted,
  type WantedState,
} from './wanted';
import { Player, type PlayerHandle } from './Player';
import { CameraRig } from './CameraRig';
import {
  Vehicle,
  damageVehicle,
  vehicleRegistry,
  type VehicleEntry,
} from './Vehicle';
import { stepVehicle, recoverVehicle, bodyYaw, NEUTRAL } from './vehiclePhysics';
import { TrafficSystem, pickTrafficSpawns } from './systems/traffic';
import { PedestrianSystem } from './systems/pedestrians';
import { PoliceSystem } from './systems/police';
import { Pedestrians } from './Pedestrians';
import { MissionMarkers } from './MissionMarkers';
import { makeRng } from './world';
import {
  clearAllPresses,
  consumePress,
  injectPress,
  getInput,
  requestPointerLock,
} from './input';
import { audio } from './audio';
import { minimapBridge } from './minimapBridge';
import { installTestBridge } from './testBridge';
import type { MissionId, Vec2 } from './types';
import type { RapierCollider } from './rapierTypes';

const POLICE_POOL_SIZE = WANTED.maxStars;

/** Candidate offsets (right, left, back, front) for exiting a vehicle. */
const EXIT_OFFSETS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, -1],
  [0, 1],
];

interface SimulationProps {
  quality: 'low' | 'high';
}

export function Simulation({ quality }: SimulationProps) {
  const { camera } = useThree();
  const { world: rapierWorld, rapier } = useRapier();

  const playerRef = useRef<PlayerHandle>(null);
  const yawRef = useRef(0);
  const pitchRef = useRef(0.22);
  const camTarget = useRef(new THREE.Vector3());

  const control = useGame((s) => s.control);
  const actions = useGame((s) => s.actions);

  // A ref mirror of control so the frame loop never re-subscribes.
  const controlRef = useRef(control);
  controlRef.current = control;

  const budgets = TRAFFIC[quality];

  const traffic = useMemo(
    () => new TrafficSystem(world.graph, makeRng(0xa11ce)),
    [],
  );
  const peds = useMemo(
    () => new PedestrianSystem(world.sidewalkNodes, makeRng(0x9ed5)),
    [],
  );
  const police = useMemo(
    () => new PoliceSystem(world.graph, makeRng(0xc0b5)),
    [],
  );

  const trafficSpawns = useMemo(
    () =>
      pickTrafficSpawns(
        world.graph,
        budgets.cars,
        world.playerSpawn,
        makeRng(0x7ac1),
      ),
    [budgets.cars],
  );

  /** All mutable gameplay state that must not live in React. */
  const sim = useRef({
    mission: initialRuntime() as MissionRuntime,
    wanted: initialWanted() as WantedState,
    /** Vehicle the player currently drives. */
    vehicleId: null as string | null,
    /** Guards E so entering and exiting cannot happen on the same press. */
    interactLock: 0,
    recoverCooldown: 0,
    accumulator: 0,
    hudTimer: 0,
    saveTimer: 0,
    playerPos: new THREE.Vector3(),
    playerSpeed: 0,
    /** Cash mirrored locally so mission payouts do not read React state. */
    health: PLAYER.maxHealth,
    respawnTimer: 0,
    sirenActive: false,
    skidCooldown: 0,
    /** Set when a mission forced heat, so we do not re-force every frame. */
    missionHeatApplied: false,
    nearestPoliceDist: Infinity,
  });

  const missionRef = useRef(sim.current.mission);

  /**
   * The frame loop needs handlers that are declared further down this
   * component. They are published here after declaration so the loop never
   * holds a forward reference to a still-initialising binding.
   */
  const handlers = useRef<{
    onFootInteract: () => void;
    prompts: (driving: boolean, entry: VehicleEntry | undefined) => void;
    collisions: (dt: number) => void;
    missions: (dt: number, driving: boolean) => void;
  }>({
    onFootInteract: () => {},
    prompts: () => {},
    collisions: () => {},
    missions: () => {},
  });

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  const pushMissionHud = useCallback(() => {
    const rt = sim.current.mission;
    const def = rt.activeId ? missionById(rt.activeId) : null;
    const obj = def?.objectives[rt.objectiveIndex] ?? null;
    actions.setMissionHud({
      activeMission: rt.activeId,
      objectiveIndex: rt.objectiveIndex,
      objectiveText: obj?.text ?? '',
      missionTime: Number.isFinite(rt.timeRemaining) ? rt.timeRemaining : null,
      missionStatus: { ...rt.status },
    });
  }, [actions]);

  /** Currently driven vehicle entry, if any. */
  const currentVehicle = (): VehicleEntry | undefined => {
    const id = sim.current.vehicleId;
    return id ? vehicleRegistry.get(id) : undefined;
  };

  const enterVehicle = useCallback(
    (entry: VehicleEntry) => {
      const player = playerRef.current;
      if (!player) return;

      sim.current.vehicleId = entry.id;
      entry.playerDriven = true;
      entry.input.throttle = 0;
      entry.input.steer = 0;
      entry.input.handbrake = false;
      player.setEnabled(false);

      actions.setVehicle(entry.id);
      audio.startEngine();

      // Stealing a civilian car is the canonical one-star trigger.
      if (entry.role !== 'police' && !entry.stolen) {
        entry.stolen = true;
        const res = addHeat(sim.current.wanted, 1);
        sim.current.wanted = res.state;
        if (res.changed) {
          actions.notify('Vehicle theft reported — 1 star', 'warn');
          actions.setHud({ wantedStars: res.state.stars });
        }
      }
      actions.notify(`Entered ${VEHICLE_SPECS[entry.kind].label}`, 'info');
    },
    [actions],
  );

  /**
   * Find a clear spot beside the car to step out into. Returns null when every
   * candidate is blocked, so the caller can explain why exiting is unavailable.
   */
  const findExitPosition = useCallback(
    (entry: VehicleEntry): THREE.Vector3 | null => {
      const t = entry.body.translation();
      const yaw = bodyYaw(entry.body);
      const spec = VEHICLE_SPECS[entry.kind];
      const side = spec.halfExtents[0] + PLAYER.radius + 0.55;
      const back = spec.halfExtents[2] + PLAYER.radius + 0.7;

      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const shape = new rapier.Capsule(PLAYER.capsuleHalfHeight, PLAYER.radius);
      const y = PLAYER.capsuleHalfHeight + PLAYER.radius + 0.15;

      for (const [ox, oz] of EXIT_OFFSETS) {
        const localX = ox * side;
        const localZ = oz * back;
        // Rotate the local offset into world space.
        const wx = t.x + localX * cos + localZ * sin;
        const wz = t.z - localX * sin + localZ * cos;

        const pos = { x: wx, y, z: wz };
        const hit = rapierWorld.intersectionWithShape(
          pos,
          { x: 0, y: 0, z: 0, w: 1 },
          shape,
          undefined,
          undefined,
          undefined,
          undefined,
          // Ignore the car we are climbing out of.
          (collider: RapierCollider) => {
            const ud = collider.parent()?.userData as
              | { vehicleId?: string }
              | undefined;
            return ud?.vehicleId !== entry.id;
          },
        );
        if (!hit) return new THREE.Vector3(wx, y, wz);
      }
      return null;
    },
    [rapier, rapierWorld],
  );

  const exitVehicle = useCallback(
    (entry: VehicleEntry) => {
      const player = playerRef.current;
      if (!player) return;

      if (entry.telemetry.speed > DRIVING.exitMaxSpeed) {
        actions.notify('Slow down before getting out', 'warn');
        return;
      }

      const spot = findExitPosition(entry);
      if (!spot) {
        actions.notify('No room to get out — move the car', 'warn');
        return;
      }

      sim.current.vehicleId = null;
      entry.playerDriven = false;
      entry.input.throttle = 0;
      entry.input.steer = 0;
      entry.input.handbrake = true;

      player.setEnabled(true);
      player.setPosition(spot.x, spot.y, spot.z);
      player.setFacing(bodyYaw(entry.body));

      actions.setVehicle(null);
      audio.stopEngine();
    },
    [actions, findExitPosition],
  );

  const respawnAtSafehouse = useCallback(
    (arrested: boolean) => {
      const player = playerRef.current;
      const entry = currentVehicle();
      if (entry) {
        entry.playerDriven = false;
        entry.input.throttle = 0;
        entry.input.handbrake = true;
        sim.current.vehicleId = null;
        audio.stopEngine();
      }

      sim.current.wanted = clearWanted(sim.current.wanted);
      police.clear();
      sim.current.sirenActive = false;
      audio.stopSiren();

      sim.current.health = PLAYER.maxHealth;

      // Fail whatever mission was running — an arrest ends the job.
      const rt = sim.current.mission;
      if (rt.activeId) {
        const failedId = rt.activeId;
        sim.current.mission = failMission(rt, failedId);
        actions.notify(`${missionById(failedId).title} failed`, 'danger');
      }

      if (player) {
        player.setEnabled(true);
        player.setPosition(
          world.playerSpawn.x,
          PLAYER.capsuleHalfHeight + PLAYER.radius + 0.2,
          world.playerSpawn.z + 2,
        );
      }

      actions.setVehicle(null);
      actions.setHud({
        health: PLAYER.maxHealth,
        wantedStars: 0,
        speed: 0,
        vehicleHealth: 100,
      });

      if (arrested) {
        actions.spendCash(WANTED.arrestCashPenalty);
        actions.notify(
          `Busted — $${WANTED.arrestCashPenalty} bail paid`,
          'danger',
        );
        audio.jingle('fail');
      }

      pushMissionHud();
      actions.saveProgress({ x: world.playerSpawn.x, z: world.playerSpawn.z });
    },
    [actions, police, pushMissionHud],
  );

  // ---------------------------------------------------------------------
  // Setup / teardown
  // ---------------------------------------------------------------------

  useEffect(() => {
    camera.position.set(
      world.playerSpawn.x,
      6,
      world.playerSpawn.z + 10,
    );

    // Reset all gameplay state for a fresh run.
    const completed = (Object.keys(useGame.getState().missionStatus) as MissionId[])
      .filter((id) => useGame.getState().missionStatus[id] === 'completed');
    sim.current.mission = initialRuntime(completed);
    sim.current.wanted = initialWanted();
    sim.current.vehicleId = null;
    sim.current.health = PLAYER.maxHealth;
    sim.current.accumulator = 0;
    missionRef.current = sim.current.mission;

    peds.spawn(budgets.peds, world.playerSpawn);

    police.setOccluders(world.buildings);
    police.setPool(
      Array.from({ length: POLICE_POOL_SIZE }, (_, i) => `police-${i}`),
    );

    clearAllPresses();
    pushMissionHud();

    return () => {
      police.clear();
      peds.clear();
      traffic.resetAll();
      audio.stopEngine();
      audio.stopSiren();
    };
  }, [budgets.peds, camera, peds, police, traffic, pushMissionHud]);

  // Police cruisers start parked far below the map until a pursuit needs them.
  const policeSpawns = useMemo(
    () =>
      Array.from({ length: POLICE_POOL_SIZE }, (_, i) => ({
        id: `police-${i}`,
        position: [i * 6 - 6, -300, 0] as [number, number, number],
      })),
    [],
  );

  // ---------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------

  /**
   * Vehicle dynamics run inside Rapier's own fixed step, so every solver
   * iteration sees exactly one set of engine/grip impulses. Driving this from
   * a separate accumulator in useFrame drifts out of sync with the solver.
   */
  useBeforePhysicsStep(() => {
    const ctrl = controlRef.current;
    if (ctrl === 'paused' || ctrl === 'menu') return;
    const dt = PHYSICS.timeStep;
    for (const v of vehicleRegistry.values()) {
      // Stowed police cruisers sit far below the city; skip them entirely.
      if (v.body.translation().y < -50) continue;
      if (v.damageCooldown > 0) v.damageCooldown -= dt;
      stepVehicle(
        v.body,
        VEHICLE_SPECS[v.kind],
        v.disabled ? NEUTRAL : v.input,
        dt,
        v.telemetry,
      );
    }
  });

  useFrame((_, rawDelta) => {
    const s = sim.current;
    const ctrl = controlRef.current;
    const player = playerRef.current;
    if (!player) return;

    const paused = ctrl === 'paused' || ctrl === 'menu';

    // Always track the player's transform so the camera has a target, even
    // while paused (so the pause screen is not looking at the origin).
    const driving = ctrl === 'driving' && s.vehicleId !== null;
    const entry = currentVehicle();

    if (driving && entry) {
      const t = entry.body.translation();
      s.playerPos.set(t.x, t.y, t.z);
      s.playerSpeed = entry.telemetry.speed;
      camTarget.current.set(t.x, t.y + 1.2, t.z);
    } else {
      player.getPosition(s.playerPos);
      s.playerSpeed = player.getSpeed();
      camTarget.current.set(
        s.playerPos.x,
        s.playerPos.y + PLAYER.eyeHeight * 0.55,
        s.playerPos.z,
      );
    }

    // Publish to the minimap at ~20 Hz via a plain object (no React churn).
    minimapBridge.playerX = s.playerPos.x;
    minimapBridge.playerZ = s.playerPos.z;
    minimapBridge.playerYaw = driving && entry ? bodyYaw(entry.body) : yawRef.current;

    if (paused) {
      // Neutralise every car so nothing creeps while the game is paused.
      for (const v of vehicleRegistry.values()) {
        v.input.throttle = 0;
        v.input.steer = 0;
        v.input.handbrake = true;
      }
      return;
    }

    // Clamp the delta so a long tab-out cannot explode the simulation.
    const delta = Math.min(rawDelta, PHYSICS.maxDelta);

    // ---- Discrete input ------------------------------------------------
    if (s.interactLock > 0) s.interactLock -= delta;
    if (s.recoverCooldown > 0) s.recoverCooldown -= delta;
    if (s.skidCooldown > 0) s.skidCooldown -= delta;

    if (consumePress('interact') && s.interactLock <= 0) {
      s.interactLock = 0.35;
      if (driving && entry) {
        exitVehicle(entry);
      } else {
        handlers.current.onFootInteract();
      }
    }

    if (consumePress('recover')) {
      if (driving && entry && s.recoverCooldown <= 0) {
        s.recoverCooldown = DRIVING.recoverCooldown;
        recoverVehicle(entry.body, bodyYaw(entry.body));
        entry.disabled = false;
        entry.health = Math.max(entry.health, 25);
        actions.notify('Vehicle recovered', 'info');
      }
    }

    // ---- Driving input --------------------------------------------------
    const input = getInput();
    if (driving && entry && !entry.disabled) {
      entry.input.throttle = input.forward;
      entry.input.steer = -input.strafe; // A steers left
      entry.input.handbrake = input.jump;

      if (
        entry.input.handbrake &&
        entry.telemetry.speed > 6 &&
        s.skidCooldown <= 0
      ) {
        s.skidCooldown = 0.6;
        audio.skid();
      }
    } else if (driving && entry) {
      entry.input.throttle = 0;
      entry.input.steer = 0;
      entry.input.handbrake = true;
    }

    // ---- AI systems ------------------------------------------------------
    traffic.update(delta, s.playerPos.x, s.playerPos.z);
    peds.update(delta, s.playerPos.x, s.playerPos.z);

    const playerVec: Vec2 = { x: s.playerPos.x, z: s.playerPos.z };
    const stars = s.wanted.stars;
    const policeResult = police.update(
      delta,
      stars,
      playerVec,
      s.playerSpeed,
      desiredUnits(stars),
    );
    s.nearestPoliceDist = policeResult.nearestDistance;

    // ---- Wanted level ----------------------------------------------------
    const wantedTick = tickWanted(s.wanted, {
      dt: delta,
      detected: policeResult.detected,
      arrestable: policeResult.arrestable,
    });
    const prevStars = s.wanted.stars;
    s.wanted = wantedTick.state;

    if (wantedTick.arrested) {
      respawnAtSafehouse(true);
      return;
    }

    if (wantedTick.decayed) {
      actions.setHud({ wantedStars: s.wanted.stars });
      if (s.wanted.stars === 0) {
        actions.notify('You lost the police', 'success');
        audio.jingle('success');
      } else {
        actions.notify(`Heat dropping — ${s.wanted.stars} star${s.wanted.stars === 1 ? '' : 's'}`, 'info');
      }
    } else if (prevStars !== s.wanted.stars) {
      actions.setHud({ wantedStars: s.wanted.stars });
    }

    // ---- Sirens ----------------------------------------------------------
    const wantSiren = s.wanted.stars > 0 && policeResult.nearestDistance < 130;
    if (wantSiren && !s.sirenActive) {
      s.sirenActive = true;
      audio.startSiren();
    } else if (!wantSiren && s.sirenActive) {
      s.sirenActive = false;
      audio.stopSiren();
    }
    if (s.sirenActive) {
      audio.updateSiren(
        1 - Math.min(1, policeResult.nearestDistance / 130),
      );
    }

    // ---- Engine audio ----------------------------------------------------
    if (driving && entry) {
      const spec = VEHICLE_SPECS[entry.kind];
      audio.updateEngine(
        Math.min(1, entry.telemetry.speed / spec.maxSpeed),
        Math.abs(entry.input.throttle),
      );
    }

    // ---- Collision damage ------------------------------------------------
    handlers.current.collisions(delta);

    // ---- Missions --------------------------------------------------------
    handlers.current.missions(delta, driving);

    // ---- Prompts + HUD throttling ---------------------------------------
    s.hudTimer += delta;
    if (s.hudTimer >= 0.1) {
      s.hudTimer = 0;
      handlers.current.prompts(driving, entry);
      actions.setHud({
        speed: driving && entry ? entry.telemetry.speed : s.playerSpeed,
        vehicleHealth: entry
          ? (entry.health / VEHICLE_SPECS[entry.kind].maxHealth) * 100
          : 100,
        health: s.health,
      });
      minimapBridge.police = police.getUnitPositions();
      actions.pruneNotifications();
    }

    // Periodic autosave while free-roaming and safe.
    s.saveTimer += delta;
    if (s.saveTimer > 25) {
      s.saveTimer = 0;
      if (s.wanted.stars === 0 && !sim.current.mission.activeId) {
        actions.saveProgress({ x: s.playerPos.x, z: s.playerPos.z });
      }
    }
  });

  // ---------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------

  /** Nearest enterable vehicle within range, or null. */
  const findNearestVehicle = useCallback((): VehicleEntry | null => {
    const s = sim.current;
    let best: VehicleEntry | null = null;
    let bestD = DRIVING.enterRadius;
    for (const v of vehicleRegistry.values()) {
      if (v.playerDriven) continue;
      const t = v.body.translation();
      if (t.y < -50) continue;
      const d = Math.hypot(t.x - s.playerPos.x, t.z - s.playerPos.z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }, []);

  /** Nearest startable mission whose marker the player is standing in. */
  const findMissionAtPlayer = useCallback((): MissionId | null => {
    const s = sim.current;
    for (const def of missionDefs) {
      if (!canStart(s.mission, def.id)) continue;
      const d = Math.hypot(
        s.playerPos.x - def.start.x,
        s.playerPos.z - def.start.z,
      );
      if (d <= MISSION.startRadius) return def.id;
    }
    return null;
  }, []);

  const handleOnFootInteract = useCallback(() => {
    const s = sim.current;

    // Priority: a mission marker under our feet beats a nearby car.
    const missionId = findMissionAtPlayer();
    if (missionId) {
      const def = missionById(missionId);
      s.mission = startMission(s.mission, def);
      if (def.startingWanted) {
        s.wanted = setStars(s.wanted, def.startingWanted);
        actions.setHud({ wantedStars: s.wanted.stars });
      }
      actions.notify(`Mission started: ${def.title}`, 'success');
      audio.jingle('blip');
      pushMissionHud();
      return;
    }

    const vehicle = findNearestVehicle();
    if (vehicle) {
      if (vehicle.disabled) {
        actions.notify('This vehicle is wrecked', 'warn');
        return;
      }
      enterVehicle(vehicle);
    }
  }, [
    actions,
    enterVehicle,
    findMissionAtPlayer,
    findNearestVehicle,
    pushMissionHud,
  ]);

  const updatePrompts = useCallback(
    (driving: boolean, entry: VehicleEntry | undefined) => {
      if (driving && entry) {
        const canExit = entry.telemetry.speed <= DRIVING.exitMaxSpeed;
        actions.setPrompt(
          null,
          canExit ? 'E — Get out' : 'Slow down to exit',
        );
        return;
      }

      const missionId = findMissionAtPlayer();
      if (missionId) {
        actions.setPrompt(null, `E — Start "${missionById(missionId).title}"`);
        return;
      }

      const vehicle = findNearestVehicle();
      if (vehicle) {
        actions.setPrompt(
          vehicle.id,
          vehicle.disabled
            ? 'Vehicle wrecked'
            : `E — Enter ${VEHICLE_SPECS[vehicle.kind].label}`,
        );
        return;
      }
      actions.setPrompt(null, null);
    },
    [actions, findMissionAtPlayer, findNearestVehicle],
  );

  // ---------------------------------------------------------------------
  // Collisions -> damage + heat
  // ---------------------------------------------------------------------

  const processCollisions = useCallback(
    (dt: number) => {
      const s = sim.current;
      const driven = currentVehicle();
      if (!driven) return;

      // Rapier exposes contact forces per collider pair; a simpler and very
      // stable proxy for "we crashed" is a sudden loss of speed.
      const speedNow = driven.telemetry.speed;
      const prev = (driven as VehicleEntry & { _prevSpeed?: number })._prevSpeed ?? speedNow;
      (driven as VehicleEntry & { _prevSpeed?: number })._prevSpeed = speedNow;

      const drop = prev - speedNow;
      // A hard hit sheds a lot of speed in one frame; braking never does.
      if (drop > 4.5 && dt < 0.06) {
        const impulse = drop * VEHICLE_SPECS[driven.kind].mass;
        const res = damageVehicle(driven, impulse);
        if (res.damaged) {
          audio.collision(Math.min(1, drop / 12));
          s.health = Math.max(0, s.health - drop * 0.9);
        }
        if (res.destroyed) {
          actions.notify('Vehicle wrecked — press R or get out', 'danger');
        }

        // Ramming a police car is a heat event, rate-limited by addHeat.
        let nearPolice = false;
        const dt2 = driven.body.translation();
        for (const v of vehicleRegistry.values()) {
          if (v.role !== 'police') continue;
          const t = v.body.translation();
          if (t.y < -50) continue;
          if (Math.hypot(t.x - dt2.x, t.z - dt2.z) < 7) {
            nearPolice = true;
            break;
          }
        }

        if (impulse > WANTED.ramImpulseThreshold) {
          const heat = addHeat(s.wanted, nearPolice ? 1 : s.wanted.stars > 0 ? 1 : 0);
          s.wanted = heat.state;
          if (heat.changed) {
            actions.setHud({ wantedStars: s.wanted.stars });
            actions.notify(
              nearPolice ? 'Assaulting an officer — heat up' : 'Reckless driving — heat up',
              'danger',
            );
          }
        }

        if (s.health <= 0) {
          respawnAtSafehouse(false);
          actions.notify('You were knocked out — back at the safehouse', 'danger');
        }
      }
    },
    [actions, respawnAtSafehouse],
  );

  // ---------------------------------------------------------------------
  // Mission progression
  // ---------------------------------------------------------------------

  const updateMissions = useCallback(
    (dt: number, driving: boolean) => {
      const s = sim.current;
      const rt = s.mission;
      if (!rt.activeId) {
        minimapBridge.objective = null;
        minimapBridge.missionStarts = missionDefs
          .filter((d) => canStart(rt, d.id))
          .map((d) => ({ x: d.start.x, z: d.start.z }));
        return;
      }

      const def = missionById(rt.activeId);

      // Timer (paused frames never reach here, so it stops with the game).
      const ticked = tickTimer(rt, dt);
      s.mission = ticked.runtime;
      if (ticked.expired) {
        const id = rt.activeId;
        s.mission = failMission(s.mission, id);
        actions.notify(`${def.title} failed — out of time`, 'danger');
        audio.jingle('fail');
        pushMissionHud();
        return;
      }

      const obj = def.objectives[s.mission.objectiveIndex];
      if (!obj) return;

      minimapBridge.objective = obj.target
        ? { x: obj.target.x, z: obj.target.z }
        : null;
      minimapBridge.missionStarts = [];

      const satisfied = isObjectiveSatisfied(obj, {
        playerX: s.playerPos.x,
        playerZ: s.playerPos.z,
        speed: s.playerSpeed,
        inVehicle: driving,
        wanted: s.wanted.stars,
      });

      if (!satisfied) {
        // Keep the HUD timer live.
        if (Number.isFinite(s.mission.timeRemaining)) {
          const now = Math.ceil(s.mission.timeRemaining);
          if (now !== Math.ceil(ticked.runtime.timeRemaining + dt)) {
            pushMissionHud();
          }
        }
        return;
      }

      const result = advanceObjective(s.mission, def);
      s.mission = result.runtime;

      if (result.completed) {
        // Reward is paid at most once, ever — advanceObjective enforces it.
        if (result.reward > 0) {
          actions.addCash(result.reward);
          actions.notify(
            `${def.title} complete — $${result.reward}`,
            'success',
          );
        } else {
          actions.notify(`${def.title} complete`, 'success');
        }
        audio.jingle('success');
        // Completing a job is a meaningful save point.
        actions.saveProgress({ x: s.playerPos.x, z: s.playerPos.z });
      } else {
        actions.notify('Objective complete', 'success');
        audio.jingle('blip');
      }
      pushMissionHud();
    },
    [actions, pushMissionHud],
  );

  // Publish the handlers now that every callback above is initialised. This
  // runs in an effect (not during render) so the frame loop only ever sees a
  // fully committed set.
  useEffect(() => {
    handlers.current.onFootInteract = handleOnFootInteract;
    handlers.current.prompts = updatePrompts;
    handlers.current.collisions = processCollisions;
    handlers.current.missions = updateMissions;
  }, [handleOnFootInteract, updatePrompts, processCollisions, updateMissions]);

  // Dev-only: let the harness aim the camera for screenshots.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__setYaw = (y: number) => {
      yawRef.current = y;
    };
    (window as unknown as Record<string, unknown>).__setPitch = (v: number) => {
      pitchRef.current = v;
    };
  }, []);

  // Dev-only automation bridge for the verification harness.
  useEffect(() => {
    return installTestBridge({
      sim,
      police,
      rapierWorld,
      setPlayerPosition: (x, y, z) => playerRef.current?.setPosition(x, y, z),
      enterVehicleById: (id) => {
        const v = vehicleRegistry.get(id);
        if (v) enterVehicle(v);
      },
      setStars: (n) => {
        sim.current.wanted =
          n <= 0 ? clearWanted(sim.current.wanted) : setStars(sim.current.wanted, n);
        actions.setHud({ wantedStars: sim.current.wanted.stars });
      },
      forceArrest: () => respawnAtSafehouse(true),
      pressKey: (k) => injectPress(k),
      startMission: (id) => {
        const def = missionById(id);
        if (!canStart(sim.current.mission, id)) return false;
        sim.current.mission = startMission(sim.current.mission, def);
        if (def.startingWanted) {
          sim.current.wanted = setStars(sim.current.wanted, def.startingWanted);
          actions.setHud({ wantedStars: sim.current.wanted.stars });
        }
        pushMissionHud();
        return sim.current.mission.activeId === id;
      },
      resetMissionStatus: (id) => {
        // Make a finished mission startable again so the harness can drive it.
        sim.current.mission = {
          ...sim.current.mission,
          activeId: null,
          objectiveIndex: 0,
          timeRemaining: Infinity,
          status: { ...sim.current.mission.status, [id]: 'available' },
        };
        pushMissionHud();
      },
      advanceMissionStep: () => false,
    });
  }, [
    actions,
    enterVehicle,
    police,
    pushMissionHud,
    rapierWorld,
    respawnAtSafehouse,
  ]);

  // Keep the mission HUD timer refreshing about once a second.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (controlRef.current === 'onfoot' || controlRef.current === 'driving') {
        if (sim.current.mission.activeId) pushMissionHud();
      }
    }, 500);
    return () => window.clearInterval(t);
  }, [pushMissionHud]);

  // Re-request pointer lock when gameplay resumes from a click.
  useEffect(() => {
    if (control === 'onfoot' || control === 'driving') {
      // Only fires from the click that dismissed the menu, which is a gesture.
      requestPointerLock();
    }
  }, [control]);

  const active = control === 'onfoot';

  return (
    <>
      <Player
        ref={playerRef}
        yawRef={yawRef}
        active={active}
        paused={control === 'paused' || control === 'menu'}
      />

      <CameraRig
        yawRef={yawRef}
        pitchRef={pitchRef}
        targetRef={camTarget}
        driving={control === 'driving'}
        paused={control === 'paused'}
        enabled
      />

      {parkedVehicles.map((v) => (
        <Vehicle
          key={v.id}
          id={v.id}
          kind={v.kind}
          role="parked"
          position={[v.x, 0.9, v.z]}
          rotation={v.rotation}
        />
      ))}

      {trafficSpawns.map((sp, i) => (
        <Vehicle
          key={`traffic-${i}`}
          id={`traffic-${i}`}
          kind={i % 4 === 0 ? 'sports' : 'compact'}
          role="traffic"
          position={[sp.x, 0.9, sp.z]}
          rotation={sp.rotation}
        />
      ))}

      {policeSpawns.map((sp) => (
        <Vehicle
          key={sp.id}
          id={sp.id}
          kind="police"
          role="police"
          position={sp.position}
          rotation={0}
          sirenOn
        />
      ))}

      <Pedestrians system={peds} />
      <MissionMarkers simRef={sim} />
    </>
  );
}
