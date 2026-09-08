import { describe, expect, it } from 'vitest';
import {
  advanceObjective,
  buildMissions,
  canStart,
  failMission,
  initialRuntime,
  isObjectiveSatisfied,
  startMission,
  tickTimer,
} from '../missions';
import { generateWorld } from '../world';

const world = generateWorld();
const missions = buildMissions(world);
const delivery = missions.find((m) => m.id === 'delivery')!;
const checkpoint = missions.find((m) => m.id === 'checkpoint')!;

describe('mission definitions', () => {
  it('defines all three missions with rewards and objectives', () => {
    expect(missions.map((m) => m.id).sort()).toEqual([
      'checkpoint',
      'delivery',
      'heat',
    ]);
    for (const m of missions) {
      expect(m.reward).toBeGreaterThan(0);
      expect(m.objectives.length).toBeGreaterThan(0);
      expect(m.title.length).toBeGreaterThan(0);
    }
  });

  it('gives the checkpoint run six ordered checkpoints', () => {
    // First objective is "get in a vehicle", the rest are gates.
    const gates = checkpoint.objectives.filter((o) => o.target !== null);
    expect(gates).toHaveLength(6);
  });

  it('starts the heat mission with two wanted stars', () => {
    const heat = missions.find((m) => m.id === 'heat')!;
    expect(heat.startingWanted).toBe(2);
  });
});

describe('mission state transitions', () => {
  it('only allows one active mission at a time', () => {
    let rt = initialRuntime();
    expect(canStart(rt, 'delivery')).toBe(true);
    rt = startMission(rt, delivery);
    expect(rt.activeId).toBe('delivery');
    expect(rt.status.delivery).toBe('active');
    // A second mission cannot start while one is running.
    expect(canStart(rt, 'checkpoint')).toBe(false);
    const unchanged = startMission(rt, checkpoint);
    expect(unchanged.activeId).toBe('delivery');
  });

  it('walks objectives in order and completes on the last one', () => {
    let rt = startMission(initialRuntime(), delivery);
    for (let i = 0; i < delivery.objectives.length - 1; i++) {
      const res = advanceObjective(rt, delivery);
      expect(res.completed).toBe(false);
      expect(res.reward).toBe(0);
      rt = res.runtime;
      expect(rt.objectiveIndex).toBe(i + 1);
    }
    const final = advanceObjective(rt, delivery);
    expect(final.completed).toBe(true);
    expect(final.reward).toBe(delivery.reward);
    expect(final.runtime.status.delivery).toBe('completed');
    expect(final.runtime.activeId).toBeNull();
  });

  it('pays the reward exactly once even if completion re-fires', () => {
    let rt = startMission(initialRuntime(), delivery);
    rt = { ...rt, objectiveIndex: delivery.objectives.length - 1 };
    const first = advanceObjective(rt, delivery);
    expect(first.reward).toBe(delivery.reward);

    // Simulate the player lingering in the trigger: mission is no longer
    // active, so a repeat advance is a no-op and pays nothing.
    const second = advanceObjective(first.runtime, delivery);
    expect(second.reward).toBe(0);
    expect(second.completed).toBe(false);
  });

  it('does not re-pay when a completed mission is somehow restarted', () => {
    let rt = startMission(initialRuntime(), delivery);
    rt = { ...rt, objectiveIndex: delivery.objectives.length - 1 };
    rt = advanceObjective(rt, delivery).runtime;
    expect(rt.rewardPaid.delivery).toBe(true);

    // Completed missions are not restartable at all.
    expect(canStart(rt, 'delivery')).toBe(false);

    // Even if forced active, the payout is suppressed by rewardPaid.
    const forced = {
      ...rt,
      activeId: 'delivery' as const,
      objectiveIndex: delivery.objectives.length - 1,
    };
    expect(advanceObjective(forced, delivery).reward).toBe(0);
  });

  it('marks failed missions retryable', () => {
    let rt = startMission(initialRuntime(), delivery);
    rt = failMission(rt, 'delivery');
    expect(rt.status.delivery).toBe('failed');
    expect(rt.activeId).toBeNull();
    expect(canStart(rt, 'delivery')).toBe(true);
  });

  it('restores completed missions from a save', () => {
    const rt = initialRuntime(['delivery']);
    expect(rt.status.delivery).toBe('completed');
    expect(rt.status.checkpoint).toBe('available');
    expect(canStart(rt, 'delivery')).toBe(false);
  });
});

describe('mission timers', () => {
  it('counts down and expires', () => {
    let rt = startMission(initialRuntime(), checkpoint);
    expect(rt.timeRemaining).toBe(checkpoint.timeLimit);

    const step = tickTimer(rt, 10);
    expect(step.expired).toBe(false);
    expect(step.runtime.timeRemaining).toBeCloseTo(checkpoint.timeLimit - 10);

    rt = { ...step.runtime, timeRemaining: 0.5 };
    const expired = tickTimer(rt, 1);
    expect(expired.expired).toBe(true);
    expect(expired.runtime.timeRemaining).toBe(0);
  });

  it('never expires an untimed mission', () => {
    const heat = missions.find((m) => m.id === 'heat')!;
    const rt = startMission(initialRuntime(), heat);
    expect(rt.timeRemaining).toBe(Infinity);
    const res = tickTimer(rt, 10_000);
    expect(res.expired).toBe(false);
  });

  it('does not tick when no mission is active', () => {
    const rt = initialRuntime();
    const res = tickTimer(rt, 5);
    expect(res.expired).toBe(false);
    expect(res.runtime).toBe(rt);
  });
});

describe('objective conditions', () => {
  const base = { playerX: 0, playerZ: 0, speed: 0, inVehicle: false, wanted: 0 };

  it('requires being in a vehicle', () => {
    const obj = { text: '', target: null, radius: 0, requireVehicle: true };
    expect(isObjectiveSatisfied(obj, base)).toBe(false);
    expect(isObjectiveSatisfied(obj, { ...base, inVehicle: true })).toBe(true);
  });

  it('requires reaching the zone', () => {
    const obj = { text: '', target: { x: 50, z: 0 }, radius: 6 };
    expect(isObjectiveSatisfied(obj, base)).toBe(false);
    expect(isObjectiveSatisfied(obj, { ...base, playerX: 48 })).toBe(true);
  });

  it('requires stopping when requireStop is set', () => {
    const obj = { text: '', target: { x: 0, z: 0 }, radius: 6, requireStop: true };
    expect(isObjectiveSatisfied(obj, { ...base, speed: 12 })).toBe(false);
    expect(isObjectiveSatisfied(obj, { ...base, speed: 0.5 })).toBe(true);
  });

  it('requires zero heat when requireNoHeat is set', () => {
    const obj = { text: '', target: null, radius: 0, requireNoHeat: true };
    expect(isObjectiveSatisfied(obj, { ...base, wanted: 2 })).toBe(false);
    expect(isObjectiveSatisfied(obj, { ...base, wanted: 0 })).toBe(true);
  });
});
