import * as THREE from 'three';
import { TRAFFIC } from '../config';
import { vehicleRegistry } from '../Vehicle';
import type { Vec2 } from '../types';

export interface Pedestrian {
  x: number;
  z: number;
  yaw: number;
  /** Index into the sidewalk waypoint list. */
  targetIndex: number;
  /** Seconds left to idle before moving again. */
  waitTimer: number;
  speed: number;
  /** Walk-cycle phase, for limb animation. */
  phase: number;
  fleeing: boolean;
  colorIndex: number;
}

const PED_COLORS = ['#c96a5a', '#5a86c9', '#6ec98a', '#c9a75a', '#9a6ec9', '#c95a9a'];
export const PED_COLOR_COUNT = PED_COLORS.length;
export { PED_COLORS };

/**
 * Pedestrians are pure data animated on the CPU and drawn as instanced meshes.
 * They deliberately have no physics bodies: they walk sidewalk waypoints,
 * which already lie outside every building footprint.
 */
export class PedestrianSystem {
  peds: Pedestrian[] = [];
  private accumulator = 0;

  private waypoints: Vec2[];
  private rng: () => number;

  constructor(waypoints: Vec2[], rng: () => number) {
    this.waypoints = waypoints;
    this.rng = rng;
  }

  spawn(count: number, player: Vec2) {
    this.peds = [];
    if (this.waypoints.length === 0) return;
    let guard = 0;
    while (this.peds.length < count && guard < count * 30) {
      guard++;
      const idx = Math.floor(this.rng() * this.waypoints.length);
      const wp = this.waypoints[idx];
      if (Math.hypot(wp.x - player.x, wp.z - player.z) < 20) continue;
      this.peds.push({
        x: wp.x,
        z: wp.z,
        yaw: this.rng() * Math.PI * 2,
        targetIndex: this.pickNearbyWaypoint(wp),
        waitTimer: this.rng() * 3,
        speed: TRAFFIC.pedSpeed * (0.8 + this.rng() * 0.5),
        phase: this.rng() * Math.PI * 2,
        fleeing: false,
        colorIndex: Math.floor(this.rng() * PED_COLORS.length),
      });
    }
  }

  /** Choose a waypoint close enough that the walk looks purposeful. */
  private pickNearbyWaypoint(from: Vec2): number {
    let best = 0;
    let bestScore = Infinity;
    // Sample a handful rather than scanning all — plenty for a natural look.
    for (let i = 0; i < 12; i++) {
      const idx = Math.floor(this.rng() * this.waypoints.length);
      const wp = this.waypoints[idx];
      const d = Math.hypot(wp.x - from.x, wp.z - from.z);
      if (d < 3) continue;
      const score = Math.abs(d - 22); // prefer ~22 m hops
      if (score < bestScore) {
        bestScore = score;
        best = idx;
      }
    }
    return best;
  }

  update(dt: number, playerX: number, playerZ: number) {
    this.accumulator += dt;
    const runFar = this.accumulator >= 1 / TRAFFIC.farUpdateHz;
    if (runFar) this.accumulator = 0;

    for (const ped of this.peds) {
      const distToPlayer = Math.hypot(ped.x - playerX, ped.z - playerZ);
      const isFar = distToPlayer > TRAFFIC.farDistance;
      if (isFar && !runFar) continue;
      const stepDt = isFar ? 1 / TRAFFIC.farUpdateHz : dt;

      // React to fast vehicles nearby: stop and back away.
      let fleeX = 0;
      let fleeZ = 0;
      let threatened = false;
      if (!isFar) {
        for (const v of vehicleRegistry.values()) {
          if (v.telemetry.speed < TRAFFIC.pedDangerSpeed) continue;
          const t = v.body.translation();
          const dx = ped.x - t.x;
          const dz = ped.z - t.z;
          const d = Math.hypot(dx, dz);
          if (d < TRAFFIC.pedDangerRadius && d > 0.01) {
            threatened = true;
            fleeX += dx / d;
            fleeZ += dz / d;
          }
        }
      }
      ped.fleeing = threatened;

      if (threatened) {
        const len = Math.hypot(fleeX, fleeZ) || 1;
        const speed = TRAFFIC.pedFleeSpeed;
        ped.x += (fleeX / len) * speed * stepDt;
        ped.z += (fleeZ / len) * speed * stepDt;
        ped.yaw = Math.atan2(fleeX, fleeZ);
        ped.phase += stepDt * 9;
        continue;
      }

      if (ped.waitTimer > 0) {
        ped.waitTimer -= stepDt;
        continue;
      }

      const target = this.waypoints[ped.targetIndex];
      if (!target) {
        ped.targetIndex = 0;
        continue;
      }

      const dx = target.x - ped.x;
      const dz = target.z - ped.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 1.0) {
        // Arrived — occasionally pause, then pick a new destination.
        ped.targetIndex = this.pickNearbyWaypoint(ped);
        if (this.rng() < 0.35) ped.waitTimer = 1 + this.rng() * 4;
        continue;
      }

      ped.x += (dx / dist) * ped.speed * stepDt;
      ped.z += (dz / dist) * ped.speed * stepDt;

      // Smoothly turn toward the direction of travel.
      const targetYaw = Math.atan2(dx, dz);
      let d = targetYaw - ped.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      ped.yaw += d * Math.min(1, 8 * stepDt);

      ped.phase += stepDt * (2.4 + ped.speed);
    }
  }

  clear() {
    this.peds = [];
  }
}

/** Write pedestrian transforms into instanced meshes. */
export function writePedestrianMatrices(
  peds: Pedestrian[],
  dummy: THREE.Object3D,
  bodies: THREE.InstancedMesh,
  heads: THREE.InstancedMesh,
  legsL: THREE.InstancedMesh,
  legsR: THREE.InstancedMesh,
  color: THREE.Color,
) {
  for (let i = 0; i < peds.length; i++) {
    const p = peds[i];
    const swing = Math.sin(p.phase) * 0.45;

    dummy.position.set(p.x, 0.92, p.z);
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.set(0.42, 0.72, 0.26);
    dummy.updateMatrix();
    bodies.setMatrixAt(i, dummy.matrix);
    bodies.setColorAt(i, color.set(PED_COLORS[p.colorIndex]));

    dummy.position.set(p.x, 1.46, p.z);
    dummy.scale.set(0.24, 0.24, 0.24);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);

    // Legs swing in opposition around the hip.
    const hipY = 0.56;
    const legLen = 0.56;
    for (const [mesh, sign] of [
      [legsL, 1],
      [legsR, -1],
    ] as const) {
      const angle = swing * sign;
      const cx = Math.sin(p.yaw) * Math.sin(angle) * legLen * 0.5;
      const cz = Math.cos(p.yaw) * Math.sin(angle) * legLen * 0.5;
      dummy.position.set(
        p.x + cx + Math.cos(p.yaw) * 0.11 * sign,
        hipY - Math.cos(angle) * legLen * 0.5,
        p.z + cz - Math.sin(p.yaw) * 0.11 * sign,
      );
      dummy.rotation.set(angle, p.yaw, 0, 'YXZ');
      dummy.scale.set(0.15, legLen, 0.15);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
  }

  bodies.count = peds.length;
  heads.count = peds.length;
  legsL.count = peds.length;
  legsR.count = peds.length;

  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  legsL.instanceMatrix.needsUpdate = true;
  legsR.instanceMatrix.needsUpdate = true;
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
}
