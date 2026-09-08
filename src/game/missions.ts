import { MISSION } from './config';
import type { MissionId, MissionStatus, Vec2, WorldData } from './types';

export interface MissionObjective {
  /** Text shown in the HUD objective line. */
  text: string;
  /** World target for the marker + minimap, if this step has one. */
  target: Vec2 | null;
  radius: number;
  /** Player must be nearly stopped inside the zone to advance. */
  requireStop?: boolean;
  /** Player must be driving a vehicle to advance. */
  requireVehicle?: boolean;
  /** Player must be on foot to advance. */
  requireOnFoot?: boolean;
  /** Advance only when wanted level is 0 (used by "Lose the Heat"). */
  requireNoHeat?: boolean;
}

export interface MissionDef {
  id: MissionId;
  title: string;
  description: string;
  /** Where the player triggers the mission from. */
  start: Vec2;
  reward: number;
  /** Overall time limit in seconds; 0 = untimed. */
  timeLimit: number;
  objectives: MissionObjective[];
  /** Wanted stars forced on when the mission starts. */
  startingWanted?: number;
  /** Mission fails if the player is arrested (all of them do). */
  failOnArrest: boolean;
}

/**
 * Missions are data, not code: the manager below walks `objectives` in order
 * and only needs to know how to test a zone, a stop, and a control state.
 */
export function buildMissions(world: WorldData): MissionDef[] {
  const { safehouse, missionBoard, garage, parkCenter, plazaCenter } = world;
  const h = world.half;

  const delivery: MissionDef = {
    id: 'delivery',
    title: 'First Delivery',
    description:
      'Pick up a parcel across town and run it to the docks before the buyer walks.',
    start: missionBoard,
    reward: 500,
    timeLimit: 240,
    failOnArrest: true,
    objectives: [
      {
        text: 'Get in a vehicle',
        target: null,
        radius: 0,
        requireVehicle: true,
      },
      {
        text: 'Drive to the pickup point',
        target: { x: plazaCenter.x, z: plazaCenter.z },
        radius: MISSION.zoneRadius,
        requireStop: true,
      },
      {
        text: 'Deliver the parcel to the docks',
        target: { x: garage.x, z: garage.z + h * 0.1 },
        radius: MISSION.zoneRadius,
        requireStop: true,
      },
    ],
  };

  // Six checkpoints forming a loop that uses the outer ring and the core.
  const cps: Vec2[] = [
    { x: plazaCenter.x, z: -h + 30 },
    { x: h - 30, z: -h + 30 },
    { x: h - 30, z: h - 30 },
    { x: plazaCenter.x, z: h - 30 },
    { x: -h + 30, z: h - 30 },
    { x: -h + 30, z: -h + 30 },
  ];

  const checkpoint: MissionDef = {
    id: 'checkpoint',
    title: 'Checkpoint Run',
    description:
      'A timed circuit of the district. Clear all six gates before the clock runs out.',
    start: { x: parkCenter.x, z: parkCenter.z },
    reward: 800,
    timeLimit: 130,
    failOnArrest: true,
    objectives: [
      { text: 'Get in a vehicle', target: null, radius: 0, requireVehicle: true },
      ...cps.map((c, i) => ({
        text: `Checkpoint ${i + 1} of ${cps.length}`,
        target: c,
        radius: MISSION.checkpointRadius,
      })),
    ],
  };

  const heat: MissionDef = {
    id: 'heat',
    title: 'Lose the Heat',
    description:
      'You are hot and the district knows it. Shake the patrols, then lie low at the safehouse.',
    start: { x: garage.x, z: garage.z - 12 },
    reward: 950,
    timeLimit: 0,
    startingWanted: 2,
    failOnArrest: true,
    objectives: [
      {
        text: 'Escape the police — lose all wanted stars',
        target: null,
        radius: 0,
        requireNoHeat: true,
      },
      {
        text: 'Return to the safehouse',
        target: { x: safehouse.x, z: safehouse.z - 12 },
        radius: MISSION.zoneRadius,
      },
    ],
  };

  return [delivery, checkpoint, heat];
}

export interface MissionRuntime {
  activeId: MissionId | null;
  objectiveIndex: number;
  /** Seconds remaining; Infinity when the mission is untimed. */
  timeRemaining: number;
  status: Record<MissionId, MissionStatus>;
  /** Guards against a trigger zone paying out twice. */
  rewardPaid: Record<MissionId, boolean>;
}

export function initialRuntime(completed: MissionId[] = []): MissionRuntime {
  const status = {
    delivery: 'available',
    checkpoint: 'available',
    heat: 'available',
  } as Record<MissionId, MissionStatus>;
  const rewardPaid = {
    delivery: false,
    checkpoint: false,
    heat: false,
  } as Record<MissionId, boolean>;
  for (const id of completed) {
    status[id] = 'completed';
    rewardPaid[id] = true;
  }
  return {
    activeId: null,
    objectiveIndex: 0,
    timeRemaining: Infinity,
    status,
    rewardPaid,
  };
}

/** True when a mission can be started right now. */
export function canStart(rt: MissionRuntime, id: MissionId): boolean {
  // Only one mission active at a time; completed missions are not repeatable.
  if (rt.activeId !== null) return false;
  const s = rt.status[id];
  return s === 'available' || s === 'failed';
}

export function startMission(rt: MissionRuntime, def: MissionDef): MissionRuntime {
  if (!canStart(rt, def.id)) return rt;
  return {
    ...rt,
    activeId: def.id,
    objectiveIndex: 0,
    timeRemaining: def.timeLimit > 0 ? def.timeLimit : Infinity,
    status: { ...rt.status, [def.id]: 'active' },
  };
}

export interface AdvanceResult {
  runtime: MissionRuntime;
  /** Cash to award — non-zero exactly once per completion. */
  reward: number;
  completed: boolean;
}

/** Advance past the current objective, completing the mission if it was last. */
export function advanceObjective(
  rt: MissionRuntime,
  def: MissionDef,
): AdvanceResult {
  if (rt.activeId !== def.id) return { runtime: rt, reward: 0, completed: false };

  const next = rt.objectiveIndex + 1;
  if (next < def.objectives.length) {
    return {
      runtime: { ...rt, objectiveIndex: next },
      reward: 0,
      completed: false,
    };
  }

  // Final objective cleared — pay out at most once, ever.
  const alreadyPaid = rt.rewardPaid[def.id];
  return {
    runtime: {
      ...rt,
      activeId: null,
      objectiveIndex: 0,
      timeRemaining: Infinity,
      status: { ...rt.status, [def.id]: 'completed' },
      rewardPaid: { ...rt.rewardPaid, [def.id]: true },
    },
    reward: alreadyPaid ? 0 : def.reward,
    completed: true,
  };
}

export function failMission(rt: MissionRuntime, id: MissionId): MissionRuntime {
  if (rt.activeId !== id) return rt;
  return {
    ...rt,
    activeId: null,
    objectiveIndex: 0,
    timeRemaining: Infinity,
    // A failed mission stays retryable.
    status: { ...rt.status, [id]: 'failed' },
  };
}

/** Tick the mission clock. Returns the runtime and whether time ran out. */
export function tickTimer(
  rt: MissionRuntime,
  dt: number,
): { runtime: MissionRuntime; expired: boolean } {
  if (rt.activeId === null || !Number.isFinite(rt.timeRemaining)) {
    return { runtime: rt, expired: false };
  }
  const remaining = rt.timeRemaining - dt;
  if (remaining <= 0) {
    return {
      runtime: { ...rt, timeRemaining: 0 },
      expired: true,
    };
  }
  return { runtime: { ...rt, timeRemaining: remaining }, expired: false };
}

export interface ObjectiveContext {
  playerX: number;
  playerZ: number;
  speed: number;
  inVehicle: boolean;
  wanted: number;
}

/** Test whether the current objective's completion conditions are all met. */
export function isObjectiveSatisfied(
  obj: MissionObjective,
  ctx: ObjectiveContext,
): boolean {
  if (obj.requireVehicle && !ctx.inVehicle) return false;
  if (obj.requireOnFoot && ctx.inVehicle) return false;
  if (obj.requireNoHeat && ctx.wanted > 0) return false;
  if (obj.target) {
    const d = Math.hypot(ctx.playerX - obj.target.x, ctx.playerZ - obj.target.z);
    if (d > obj.radius) return false;
    if (obj.requireStop && ctx.speed > MISSION.stopSpeed) return false;
  }
  return true;
}
