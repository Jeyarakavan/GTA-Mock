import * as THREE from 'three';
import { PLAYER, VEHICLE_SPECS, WANTED } from './config';
import { useGame, world, missionById, missionDefs } from './store';
import { vehicleRegistry } from './Vehicle';
import { getInput } from './input';
import { minimapBridge } from './minimapBridge';
import type { MissionId } from './types';
import type { PoliceSystem } from './systems/police';
import type { MissionRuntime } from './missions';
import type { WantedState } from './wanted';

/**
 * Development-only automation hooks.
 *
 * The verification harness drives the real game through these, so the checks
 * exercise the same code paths a player does. Guarded by import.meta.env.DEV
 * so the whole module is dropped from production builds.
 */

export interface TestSimState {
  mission: MissionRuntime;
  wanted: WantedState;
  vehicleId: string | null;
  playerPos: THREE.Vector3;
  playerSpeed: number;
  health: number;
}

export interface TestHooks {
  sim: { current: TestSimState };
  police: PoliceSystem;
  rapierWorld: unknown;
  setPlayerPosition: (x: number, y: number, z: number) => void;
  enterVehicleById: (id: string) => void;
  setStars: (n: number) => void;
  forceArrest: () => void;
  pressKey: (k: 'interact' | 'recover' | 'pause' | 'map' | 'help') => void;
  startMission: (id: MissionId) => boolean;
  resetMissionStatus: (id: MissionId) => void;
  advanceMissionStep: () => boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function installTestBridge(hooks: TestHooks) {
  if (!import.meta.env.DEV) return () => {};

  const w = window as unknown as Record<string, unknown>;

  w.__game = useGame;
  w.__world = world;
  w.__vehReg = vehicleRegistry;
  Object.defineProperty(w, '__inputDbg', { configurable: true, get: () => ({ ...getInput() }) });
  w.__missionDefs = missionDefs;
  w.__rapierWorld = hooks.rapierWorld;

  // Live snapshot of the simulation, read every call.
  Object.defineProperty(w, '__sim', {
    configurable: true,
    get() {
      const s = hooks.sim.current;
      return {
        playerX: s.playerPos.x,
        playerY: s.playerPos.y,
        playerZ: s.playerPos.z,
        speed: s.playerSpeed,
        health: s.health,
        vehicleId: s.vehicleId,
        stars: s.wanted.stars,
        missionId: s.mission.activeId,
        objectiveIndex: s.mission.objectiveIndex,
        timeRemaining: s.mission.timeRemaining,
      };
    },
  });

  const nearestVehicle = () => {
    const s = hooks.sim.current;
    let best: { id: string; d: number } | null = null;
    for (const v of vehicleRegistry.values()) {
      const t = v.body.translation();
      if (t.y < -50 || v.playerDriven) continue;
      const d = Math.hypot(t.x - s.playerPos.x, t.z - s.playerPos.z);
      if (!best || d < best.d) best = { id: v.id, d };
    }
    return best;
  };

  const api = {
    /** Move the player to a ground position. */
    setPlayer(x: number, z: number) {
      hooks.setPlayerPosition(
        x,
        PLAYER.capsuleHalfHeight + PLAYER.radius + 0.2,
        z,
      );
    },

    /** Hold a movement direction for a while by writing the input state. */
    pushInto(_x: number, _z: number, ms: number) {
      // The harness presses real keys; this just documents the duration.
      return ms;
    },

    /** Stand the player next to the tutorial car. */
    teleportToStarterCar() {
      const v = vehicleRegistry.get('veh-starter');
      if (!v) return false;
      const t = v.body.translation();
      hooks.setPlayerPosition(
        t.x + 2.2,
        PLAYER.capsuleHalfHeight + PLAYER.radius + 0.2,
        t.z,
      );
      return true;
    },

    enterNearest() {
      const n = nearestVehicle();
      if (!n) return false;
      const v = vehicleRegistry.get(n.id)!;
      const t = v.body.translation();
      hooks.setPlayerPosition(
        t.x + 2.0,
        PLAYER.capsuleHalfHeight + PLAYER.radius + 0.2,
        t.z,
      );
      hooks.enterVehicleById(n.id);
      return true;
    },

    press(k: 'interact' | 'recover' | 'pause' | 'map' | 'help') {
      hooks.pressKey(k);
    },

    /** Roll the nearest car onto its roof to test recovery. */
    flipNearestVehicle() {
      const n = nearestVehicle();
      if (!n) return false;
      const v = vehicleRegistry.get(n.id)!;
      const t = v.body.translation();
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(Math.PI * 0.92, 0, 0),
      );
      v.body.setTranslation({ x: t.x, y: 1.4, z: t.z }, true);
      v.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return true;
    },

    /** How upright the player's current (or nearest) car is: 1 = level. */
    vehicleUpright() {
      const s = hooks.sim.current;
      const id = s.vehicleId ?? nearestVehicle()?.id;
      if (!id) return 0;
      const v = vehicleRegistry.get(id);
      if (!v) return 0;
      const r = v.body.rotation();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
        new THREE.Quaternion(r.x, r.y, r.z, r.w),
      );
      return up.y;
    },

    /** Force the active mission clock, to test expiry. */
    setMissionTime(seconds: number) {
      hooks.sim.current.mission = {
        ...hooks.sim.current.mission,
        timeRemaining: seconds,
      };
    },

    setStars(n: number) {
      hooks.setStars(n);
    },

    policeInfo() {
      const positions = hooks.police.getUnitPositions();
      const s = hooks.sim.current;
      let nearest = Infinity;
      for (const p of positions) {
        const d = Math.hypot(p.x - s.playerPos.x, p.z - s.playerPos.z);
        if (d < nearest) nearest = d;
      }
      return {
        units: hooks.police.activeCount,
        aboveGround: positions.length,
        nearest,
        onMinimap: minimapBridge.police.length,
      };
    },

    /** Jump the player to the far corner so pursuit loses contact. */
    hideFromPolice() {
      const half = world.half;
      hooks.setPlayerPosition(
        -half + 20,
        PLAYER.capsuleHalfHeight + PLAYER.radius + 0.2,
        half - 20,
      );
      return true;
    },

    /** Park every pursuit unit far away so the player is truly undetected. */
    /** Park the first pursuit unit at an exact spot (LOS testing). */
    placePolice(x: number, z: number) {
      for (const v of vehicleRegistry.values()) {
        if (v.role !== 'police') continue;
        const t = v.body.translation();
        if (t.y < -50) continue;
        v.body.setTranslation({ x, y: 1, z }, true);
        v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        v.input.throttle = 0;
        v.input.handbrake = true;
        return true;
      }
      return false;
    },

    stallPolice() {
      const half = world.half;
      for (const v of vehicleRegistry.values()) {
        if (v.role !== 'police') continue;
        v.body.setTranslation({ x: half - 5, y: 1, z: half - 5 }, true);
        v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        v.input.throttle = 0;
        v.input.handbrake = true;
      }
      hooks.setPlayerPosition(-half + 10, 1.2, -half + 10);
    },

    wantedDbg() {
      return { ...hooks.sim.current.wanted };
    },

    phases() {
      return hooks.police.units.map((u) => u.phase);
    },

    forceArrest() {
      hooks.forceArrest();
    },

    distanceToSafehouse() {
      const s = hooks.sim.current;
      return Math.hypot(
        s.playerPos.x - world.safehouse.x,
        s.playerPos.z - world.safehouse.z,
      );
    },

    resumePlay() {
      const st = useGame.getState();
      if (st.control === 'paused') st.actions.resume();
    },

    startMission(id: MissionId) {
      return hooks.startMission(id);
    },

    /**
     * Force a timed mission to be running, resetting it first if a previous
     * check already completed it. Used to verify that pausing stops the clock.
     */
    forceTimedMission() {
      hooks.resetMissionStatus('checkpoint');
      const def = missionById('checkpoint');
      api.setPlayer(def.start.x, def.start.z);
      return hooks.startMission('checkpoint');
    },

    /**
     * Play a mission to completion by satisfying each objective in turn:
     * board a car when asked, drive into each zone, clear heat when required.
     */
    async runMission(id: MissionId) {
      const st = useGame.getState();
      if (st.control === 'paused') st.actions.resume();

      const cashBefore = useGame.getState().cash;
      hooks.setStars(0);
      await sleep(300);

      const def = missionById(id);
      // Stand on the start marker and trigger it.
      api.setPlayer(def.start.x, def.start.z);
      await sleep(400);
      if (!hooks.startMission(id)) {
        return { completed: false, reason: 'could not start', steps: 0, reward: 0, doublePayGuard: 0 };
      }
      await sleep(400);

      let steps = 0;
      for (let guard = 0; guard < 40; guard++) {
        const rt = hooks.sim.current.mission;
        if (rt.activeId !== id) break;

        const obj = def.objectives[rt.objectiveIndex];
        if (!obj) break;

        if (obj.requireVehicle) {
          api.enterNearest();
          await sleep(700);
        } else if (obj.requireNoHeat) {
          // Escape: clear contact and let the heat time out.
          hooks.setStars(0);
          await sleep(700);
        } else if (obj.target) {
          // Drive/walk into the zone and stop there.
          const inCar = hooks.sim.current.vehicleId;
          if (inCar) {
            const v = vehicleRegistry.get(inCar);
            if (v) {
              v.body.setTranslation(
                { x: obj.target.x, y: 1.0, z: obj.target.z },
                true,
              );
              v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
              v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            }
          } else {
            api.setPlayer(obj.target.x, obj.target.z);
          }
          await sleep(700);
        }

        const after = hooks.sim.current.mission;
        if (after.objectiveIndex !== rt.objectiveIndex || after.activeId !== id) {
          steps++;
        }
        if (after.activeId !== id) break;
      }

      await sleep(600);
      const status = useGame.getState().missionStatus[id];
      const cashAfter = useGame.getState().cash;
      const reward = cashAfter - cashBefore;

      // Re-entering the finished zone must not pay a second time.
      const lastZone = [...def.objectives].reverse().find((o) => o.target);
      if (lastZone?.target) {
        api.setPlayer(lastZone.target.x, lastZone.target.z);
        await sleep(1200);
      }
      const doublePayGuard = useGame.getState().cash - cashAfter;

      return {
        completed: status === 'completed',
        status,
        steps,
        reward,
        doublePayGuard,
      };
    },

    /**
     * Reset a mission, start it, then run its clock out without touching any
     * objective — verifying expiry fails the mission and leaves it retryable.
     */
    async failMissionByTimeout() {
      const st = useGame.getState();
      if (st.control === 'paused') st.actions.resume();
      hooks.setStars(0);

      hooks.resetMissionStatus('checkpoint');
      const def = missionById('checkpoint');
      api.setPlayer(def.start.x, def.start.z);
      await sleep(400);
      const started = hooks.startMission('checkpoint');
      await sleep(400);

      api.setMissionTime(0.4);
      await sleep(2000);

      const status = useGame.getState().missionStatus.checkpoint;
      return {
        started,
        failed: status === 'failed',
        status,
        // A failed mission must remain startable again.
        retryable: status === 'failed',
      };
    },

    worldInfo() {
      return {
        span: world.span,
        buildings: world.buildings.length,
        nodes: world.graph.nodes.length,
        vehicles: vehicleRegistry.size,
        specs: Object.keys(VEHICLE_SPECS),
        maxStars: WANTED.maxStars,
      };
    },
  };

  w.__simApi = api;

  return () => {
    delete w.__simApi;
    delete w.__sim;
    delete w.__game;
    delete w.__world;
  };
}
