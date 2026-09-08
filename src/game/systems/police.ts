import { WANTED } from '../config';
import { vehicleRegistry, type VehicleEntry } from '../Vehicle';
import { driveToward, recoverVehicle } from '../vehiclePhysics';
import { findPath, nearestNode, pickSpawnNode } from '../navigation';
import type { RoadGraph, Vec2 } from '../types';

export type PursuitPhase = 'pursue' | 'search' | 'disengage';

export interface PoliceUnit {
  vehicleId: string;
  phase: PursuitPhase;
  /** Last position where the player was actually seen. */
  lastSeen: Vec2;
  /** Seconds since this unit last had line of sight. */
  sinceSeen: number;
  /** Seconds held at arrest range on a slow player. */
  holdTimer: number;
}


export interface PoliceTickResult {
  /** Any unit currently detects the player. */
  detected: boolean;
  /** A unit is holding a slow player at arrest range. */
  arrestable: boolean;
  /** Distance to the closest unit, or Infinity. */
  nearestDistance: number;
}

/**
 * Police pursuit. Units route over the road graph with A* (so they drive
 * around blocks instead of into them), steer locally toward the next
 * waypoint, and fall back to searching the last known position when they
 * lose sight of the player.
 */
export class PoliceSystem {
  units: PoliceUnit[] = [];
  /** Vehicle ids available to be activated as pursuit units. */
  private pool: string[] = [];
  private spawnCooldown = 0;

  private graph: RoadGraph;
  private rng: () => number;
  /** Flattened building footprints used for the line-of-sight test. */
  private occluders: Array<{ x: number; z: number; hw: number; hd: number }> = [];

  constructor(graph: RoadGraph, rng: () => number) {
    this.graph = graph;
    this.rng = rng;
  }

  /** Supply the building footprints that block a police officer's view. */
  setOccluders(
    buildings: Array<{ x: number; z: number; width: number; depth: number }>,
  ) {
    this.occluders = buildings.map((b) => ({
      x: b.x,
      z: b.z,
      hw: b.width / 2,
      hd: b.depth / 2,
    }));
  }

  setPool(ids: string[]) {
    this.pool = ids;
  }

  get activeCount(): number {
    return this.units.length;
  }

  /** Park every unit and clear the pursuit. */
  clear() {
    for (const unit of this.units) {
      const v = vehicleRegistry.get(unit.vehicleId);
      if (v) {
        v.input.throttle = 0;
        v.input.steer = 0;
        v.input.handbrake = true;
        // Stow the cruiser well below the city until it is needed again.
        v.body.setTranslation({ x: v.body.translation().x, y: -300, z: v.body.translation().z }, true);
        v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    this.units = [];
    this.spawnCooldown = 0;
  }

  /** Match the number of active units to the wanted level. */
  private reconcile(desired: number, player: Vec2, dt: number) {
    this.spawnCooldown -= dt;

    while (this.units.length > desired) {
      const unit = this.units.pop()!;
      const v = vehicleRegistry.get(unit.vehicleId);
      if (v) {
        v.input.handbrake = true;
        v.body.setTranslation({ x: v.body.translation().x, y: -300, z: v.body.translation().z }, true);
        v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    if (this.units.length < desired && this.spawnCooldown <= 0) {
      const used = new Set(this.units.map((u) => u.vehicleId));
      const free = this.pool.find((id) => !used.has(id));
      if (free) {
        const v = vehicleRegistry.get(free);
        if (v) {
          // Spawn out of view: a road node at a sensible pursuit distance.
          // Pick a spawn node that no active unit is already sitting on, so
          // cruisers never materialise inside one another and jam.
          let node = this.graph.nodes[
            pickSpawnNode(
              this.graph,
              player,
              WANTED.spawnMinDistance,
              WANTED.spawnDistance,
              this.rng,
            )
          ];
          for (let attempt = 0; attempt < 8; attempt++) {
            const clash = this.units.some((u) => {
              const other = vehicleRegistry.get(u.vehicleId);
              if (!other) return false;
              const ot = other.body.translation();
              return Math.hypot(ot.x - node.x, ot.z - node.z) < 12;
            });
            if (!clash) break;
            node = this.graph.nodes[
              pickSpawnNode(
                this.graph,
                player,
                WANTED.spawnMinDistance,
                WANTED.spawnDistance,
                this.rng,
              )
            ];
          }
          // Face the cruiser toward the player so it sets off immediately.
          const spawnYaw = Math.atan2(player.x - node.x, player.z - node.z);
          const half = Math.sin(spawnYaw / 2);
          v.body.setRotation(
            { x: 0, y: half, z: 0, w: Math.cos(spawnYaw / 2) },
            true,
          );
          v.body.setTranslation({ x: node.x, y: 1.1, z: node.z }, true);
          v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          v.health = 130;
          v.disabled = false;
          v.ai.path = [];
          v.ai.pathIndex = 0;
          v.ai.repathTimer = 99; // force an immediate route
          v.ai.stuckTimer = 0;

          this.units.push({
            vehicleId: free,
            phase: 'pursue',
            lastSeen: { x: player.x, z: player.z },
            sinceSeen: 0,
            holdTimer: 0,
          });
          this.spawnCooldown = 2.2;
        }
      }
    }
  }

  /**
   * Detection requires both range and line of sight. Without the sight test
   * a unit tracks the player through solid blocks and the heat can never
   * decay, which makes escaping impossible.
   *
   * Sight is sampled along the segment between the two positions: if any
   * sample lands inside a building footprint, the view is blocked. Buildings
   * are axis-aligned boxes, so this is a handful of cheap comparisons and
   * needs no physics query.
   */
  private canSee(v: VehicleEntry, player: Vec2, radius: number): boolean {
    const t = v.body.translation();
    if (t.y < -50) return false;
    const dx = player.x - t.x;
    const dz = player.z - t.z;
    const d = Math.hypot(dx, dz);
    if (d > radius) return false;
    // Very close units always notice you, sight line or not.
    if (d <= 12) return true;

    const steps = Math.min(24, Math.max(4, Math.round(d / 6)));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      const sx = t.x + dx * f;
      const sz = t.z + dz * f;
      for (const b of this.occluders) {
        if (
          Math.abs(sx - b.x) < b.hw &&
          Math.abs(sz - b.z) < b.hd
        ) {
          return false;
        }
      }
    }
    return true;
  }

  update(
    dt: number,
    stars: number,
    player: Vec2,
    playerSpeed: number,
    desiredUnits: number,
  ): PoliceTickResult {
    if (stars <= 0) {
      if (this.units.length > 0) this.clear();
      return { detected: false, arrestable: false, nearestDistance: Infinity };
    }

    this.reconcile(desiredUnits, player, dt);

    const radius = WANTED.detectRadius[Math.min(stars, WANTED.detectRadius.length - 1)];
    // Higher heat means faster, more committed driving.
    const chaseSpeed = 16 + stars * 5;

    let detected = false;
    let arrestable = false;
    let nearestDistance = Infinity;

    for (const unit of this.units) {
      const v = vehicleRegistry.get(unit.vehicleId);
      if (!v) continue;

      const t = v.body.translation();
      const dist = Math.hypot(t.x - player.x, t.z - player.z);
      if (dist < nearestDistance) nearestDistance = dist;

      // While searching, a unit is looking for a lost target and only
      // re-acquires at closer range — otherwise a single corner is never
      // enough to shake a pursuit and the heat can never decay.
      const effectiveRadius =
        unit.phase === 'pursue' ? radius : radius * 0.55;
      const sees = this.canSee(v, player, effectiveRadius);
      if (sees) {
        detected = true;
        unit.sinceSeen = 0;
        unit.lastSeen.x = player.x;
        unit.lastSeen.z = player.z;
        unit.phase = 'pursue';
      } else {
        unit.sinceSeen += dt;
        if (unit.phase === 'pursue' && unit.sinceSeen > 1.5) unit.phase = 'search';
        if (unit.phase === 'search' && unit.sinceSeen > 18) unit.phase = 'disengage';
      }

      // Arrest: a unit must hold station on a slow player, not just pass by.
      if (
        sees &&
        dist <= WANTED.arrestRadius &&
        playerSpeed <= WANTED.arrestMaxPlayerSpeed
      ) {
        unit.holdTimer += dt;
        if (unit.holdTimer >= WANTED.arrestSeconds) arrestable = true;
      } else {
        unit.holdTimer = 0;
      }

      if (v.disabled) {
        v.input.throttle = 0;
        v.input.steer = 0;
        v.input.handbrake = true;
        continue;
      }

      // --- Routing --------------------------------------------------------
      const goalPos =
        unit.phase === 'pursue' ? player : unit.lastSeen;

      v.ai.repathTimer += dt;
      if (v.ai.repathTimer >= WANTED.repathInterval || v.ai.path.length === 0) {
        v.ai.repathTimer = 0;
        const start = nearestNode(this.graph, t.x, t.z);
        const goal = nearestNode(this.graph, goalPos.x, goalPos.z);
        const path = findPath(this.graph, start, goal);
        v.ai.path = path;
        v.ai.pathIndex = path.length > 1 ? 1 : 0;
      }

      if (unit.phase === 'disengage') {
        // Given up for now: coast to a halt, then head back toward the last
        // known position so the unit is repositioned rather than abandoned.
        // A fresh sighting flips it straight back to 'pursue' above.
        if (dist > 140) {
          // Too far to matter — recycle it onto a node near the player.
          const node = this.graph.nodes[nearestNode(this.graph, player.x, player.z)];
          v.body.setTranslation({ x: node.x, y: 1.1, z: node.z }, true);
          v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          v.ai.path = [];
          unit.phase = 'search';
          unit.sinceSeen = 0;
          continue;
        }
        v.input.throttle = -0.4;
        v.input.steer = 0;
        v.input.handbrake = false;
        continue;
      }

      let targetX: number;
      let targetZ: number;

      // Close in a straight line once we are near, otherwise follow the road.
      if (dist < 22 && unit.phase === 'pursue') {
        targetX = player.x;
        targetZ = player.z;
      } else if (v.ai.pathIndex < v.ai.path.length) {
        const node = this.graph.nodes[v.ai.path[v.ai.pathIndex]];
        // Aim at the intersection centre. Offsetting into a lane put the
        // target beyond the kerb on approach and beached the cruiser.
        targetX = node.x;
        targetZ = node.z;
        if (Math.hypot(node.x - t.x, node.z - t.z) < 12) v.ai.pathIndex++;
      } else {
        targetX = goalPos.x;
        targetZ = goalPos.z;
      }

      driveToward(v.body, targetX, targetZ, chaseSpeed, v.input);

      // Stuck / flipped recovery so a pursuit never silently dies.
      // Trying to drive but barely moving means we are wedged on something.
      if (v.telemetry.speed < 1.5 && Math.abs(v.input.throttle) > 0.5) {
        v.ai.stuckTimer += dt;
      } else {
        v.ai.stuckTimer = Math.max(0, v.ai.stuckTimer - dt * 2);
      }
      v.ai.lastX = t.x;
      v.ai.lastZ = t.z;
      if (v.ai.stuckTimer > 2.0 || v.telemetry.flipped) {
        v.ai.stuckTimer = 0;
        // Lift the unit back onto the carriageway rather than uprighting it
        // where it beached, and face it along its route.
        const road = this.graph.nodes[nearestNode(this.graph, t.x, t.z)];
        const faceYaw = Math.atan2(targetX - road.x, targetZ - road.z);
        v.body.setTranslation({ x: road.x, y: 1.0, z: road.z }, true);
        recoverVehicle(v.body, faceYaw);
        v.ai.path = [];
        v.ai.repathTimer = WANTED.repathInterval;
      }

      // Fell out of the world.
      if (t.y < -20 && t.y > -200) {
        const node = this.graph.nodes[nearestNode(this.graph, player.x, player.z)];
        v.body.setTranslation({ x: node.x, y: 1.1, z: node.z }, true);
        v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    return { detected, arrestable, nearestDistance };
  }

  /** Positions of active units, for the minimap. */
  getUnitPositions(): Vec2[] {
    const out: Vec2[] = [];
    for (const unit of this.units) {
      const v = vehicleRegistry.get(unit.vehicleId);
      if (!v) continue;
      const t = v.body.translation();
      if (t.y < -50) continue;
      out.push({ x: t.x, z: t.z });
    }
    return out;
  }
}
