import type { RapierRigidBody } from '@react-three/rapier';
import { TRAFFIC } from '../config';
import { driveToward, recoverVehicle, bodyYaw, NEUTRAL } from '../vehiclePhysics';
import type { VehicleEntry } from '../Vehicle';
import { vehicleRegistry } from '../Vehicle';
import { findPath, nearestNode, laneOffsetPoint } from '../navigation';
import type { RoadGraph, Vec2 } from '../types';

const _lanePoint: Vec2 = { x: 0, z: 0 };
const _prev: Vec2 = { x: 0, z: 0 };

/**
 * Ambient traffic. Each car follows a road-graph route, keeps to the
 * right-hand lane, slows for whatever is directly ahead, and re-routes when it
 * arrives or gets stuck.
 */
export class TrafficSystem {
  private rng: () => number;
  private accumulator = 0;

  private graph: RoadGraph;

  constructor(graph: RoadGraph, rng: () => number) {
    this.graph = graph;
    this.rng = rng;
  }

  /** Give a car a fresh route to a random distant node. */
  private repath(entry: VehicleEntry) {
    const t = entry.body.translation();
    const start = nearestNode(this.graph, t.x, t.z);
    let goal = Math.floor(this.rng() * this.graph.nodes.length);
    // Prefer a goal that is not the node we are standing on.
    if (goal === start) goal = (goal + 7) % this.graph.nodes.length;
    const path = findPath(this.graph, start, goal);
    entry.ai.path = path;
    // Skip the first node — it is where we already are.
    entry.ai.pathIndex = path.length > 1 ? 1 : 0;
    entry.ai.repathTimer = 0;
  }

  /**
   * Distance to the nearest vehicle in front of `entry`, or Infinity.
   * O(n) over a small fleet — cheaper than maintaining a spatial index here.
   */
  private distanceAhead(entry: VehicleEntry): number {
    const t = entry.body.translation();
    const yaw = bodyYaw(entry.body);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    let best = Infinity;

    for (const other of vehicleRegistry.values()) {
      if (other === entry || other.disabled) continue;
      const ot = other.body.translation();
      const dx = ot.x - t.x;
      const dz = ot.z - t.z;
      const dist = Math.hypot(dx, dz);
      if (dist > TRAFFIC.lookAhead || dist < 0.1) continue;
      // Only count vehicles roughly in our forward cone.
      const dot = (dx * fx + dz * fz) / dist;
      if (dot < 0.72) continue;
      if (dist < best) best = dist;
    }
    return best;
  }

  update(dt: number, playerX: number, playerZ: number) {
    // Distant cars update at a reduced rate to save CPU.
    this.accumulator += dt;
    const runFar = this.accumulator >= 1 / TRAFFIC.farUpdateHz;
    if (runFar) this.accumulator = 0;

    for (const entry of vehicleRegistry.values()) {
      if (entry.role !== 'traffic' || entry.playerDriven) continue;

      const t = entry.body.translation();
      const distToPlayer = Math.hypot(t.x - playerX, t.z - playerZ);
      const isFar = distToPlayer > TRAFFIC.farDistance;
      if (isFar && !runFar) continue;
      // Far cars get a proportionally larger dt so their motion stays correct.
      const stepDt = isFar ? 1 / TRAFFIC.farUpdateHz : dt;

      if (entry.disabled) {
        entry.input.throttle = 0;
        entry.input.steer = 0;
        entry.input.handbrake = true;
        continue;
      }

      entry.ai.repathTimer += stepDt;

      if (entry.ai.path.length === 0 || entry.ai.pathIndex >= entry.ai.path.length) {
        this.repath(entry);
        if (entry.ai.path.length === 0) continue;
      }

      const nodeIdx = entry.ai.path[entry.ai.pathIndex];
      const node = this.graph.nodes[nodeIdx];

      // Offset the waypoint into the right-hand lane relative to travel.
      const prevIdx =
        entry.ai.pathIndex > 0 ? entry.ai.path[entry.ai.pathIndex - 1] : nodeIdx;
      _prev.x = this.graph.nodes[prevIdx].x;
      _prev.z = this.graph.nodes[prevIdx].z;
      laneOffsetPoint(_prev, { x: node.x, z: node.z }, _lanePoint);

      const distToNode = Math.hypot(_lanePoint.x - t.x, _lanePoint.z - t.z);
      if (distToNode < 9) {
        entry.ai.pathIndex++;
        if (entry.ai.pathIndex >= entry.ai.path.length) this.repath(entry);
      }

      // Cruise speed, reduced when something blocks the road ahead.
      let desired = entry.ai.targetSpeed;
      if (desired <= 0) {
        desired =
          TRAFFIC.minSpeed + this.rng() * (TRAFFIC.maxSpeed - TRAFFIC.minSpeed);
        entry.ai.targetSpeed = desired;
      }

      const ahead = this.distanceAhead(entry);
      if (ahead < TRAFFIC.lookAhead) {
        // Linear slow-down; full stop when very close.
        const factor = Math.max(0, (ahead - 4.5) / (TRAFFIC.lookAhead - 4.5));
        desired *= factor;
      }

      driveToward(entry.body, _lanePoint.x, _lanePoint.z, desired, entry.input);

      if (desired < 0.6) {
        entry.input.throttle = -0.7;
        entry.input.steer *= 0.3;
      }

      // Stuck detection: little movement while trying to drive.
      const moved = Math.hypot(t.x - entry.ai.lastX, t.z - entry.ai.lastZ);
      entry.ai.lastX = t.x;
      entry.ai.lastZ = t.z;
      if (moved < 0.06 * stepDt * 60 && desired > 1) {
        entry.ai.stuckTimer += stepDt;
      } else {
        entry.ai.stuckTimer = 0;
      }

      if (entry.ai.stuckTimer > TRAFFIC.stuckSeconds || entry.telemetry.flipped) {
        this.recoverStuck(entry, playerX, playerZ);
      }
    }
  }

  /** Free a stuck car: upright it, or relocate it far from the player. */
  private recoverStuck(entry: VehicleEntry, playerX: number, playerZ: number) {
    entry.ai.stuckTimer = 0;
    const t = entry.body.translation();
    const dist = Math.hypot(t.x - playerX, t.z - playerZ);

    if (dist > TRAFFIC.playerClearance) {
      // Out of sight — teleport onto a random road node and re-route.
      const node =
        this.graph.nodes[Math.floor(this.rng() * this.graph.nodes.length)];
      entry.body.setTranslation({ x: node.x, y: 1.0, z: node.z }, true);
      entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.repath(entry);
    } else {
      // In view — just upright it where it stands.
      recoverVehicle(entry.body, bodyYaw(entry.body));
      this.repath(entry);
    }
  }

  /** Reset every traffic car to a fresh route (used on restart). */
  resetAll() {
    for (const entry of vehicleRegistry.values()) {
      if (entry.role !== 'traffic') continue;
      entry.ai.path = [];
      entry.ai.pathIndex = 0;
      entry.ai.targetSpeed = 0;
      entry.input = { ...NEUTRAL };
    }
  }
}

/** Spawn positions for ambient traffic, kept away from the player's view. */
export function pickTrafficSpawns(
  graph: RoadGraph,
  count: number,
  player: Vec2,
  rng: () => number,
): Array<{ x: number; z: number; rotation: number }> {
  const out: Array<{ x: number; z: number; rotation: number }> = [];
  const used = new Set<number>();
  let guard = 0;

  while (out.length < count && guard < count * 40) {
    guard++;
    const a = Math.floor(rng() * graph.segments.length);
    if (used.has(a)) continue;
    const seg = graph.segments[a];
    const na = graph.nodes[seg.a];
    const nb = graph.nodes[seg.b];
    const t = 0.25 + rng() * 0.5;
    const x = na.x + (nb.x - na.x) * t;
    const z = na.z + (nb.z - na.z) * t;
    if (Math.hypot(x - player.x, z - player.z) < TRAFFIC.playerClearance) continue;
    used.add(a);

    const rotation = Math.atan2(nb.x - na.x, nb.z - na.z);
    // Sit in the right-hand lane from the outset.
    const nx = -(nb.z - na.z);
    const nz = nb.x - na.x;
    const len = Math.hypot(nx, nz) || 1;
    out.push({
      x: x - (nx / len) * TRAFFIC.laneOffset,
      z: z - (nz / len) * TRAFFIC.laneOffset,
      rotation,
    });
  }
  return out;
}

export type { RapierRigidBody };
