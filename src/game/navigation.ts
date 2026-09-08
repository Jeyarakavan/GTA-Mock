import type { RoadGraph, Vec2 } from './types';
import { TRAFFIC, WORLD } from './config';

/** Straight-line distance between two graph nodes. */
function heuristic(graph: RoadGraph, a: number, b: number): number {
  const na = graph.nodes[a];
  const nb = graph.nodes[b];
  return Math.hypot(nb.x - na.x, nb.z - na.z);
}

/** Index of the graph node nearest a world position. */
export function nearestNode(graph: RoadGraph, x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i];
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * A* over the road graph. Returns node indices from `start` to `goal`
 * inclusive, or an empty array when no route exists.
 *
 * The graph is small (49 nodes for a 6x6 city) so a linear-scan open set is
 * faster in practice than a binary heap and allocates far less.
 */
export function findPath(graph: RoadGraph, start: number, goal: number): number[] {
  if (start === goal) return [start];
  const n = graph.nodes.length;
  if (start < 0 || goal < 0 || start >= n || goal >= n) return [];

  const gScore = new Float64Array(n).fill(Infinity);
  const fScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open: number[] = [start];

  gScore[start] = 0;
  fScore[start] = heuristic(graph, start, goal);

  while (open.length > 0) {
    // Pop the lowest-f node.
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (fScore[open[i]] < fScore[open[bestIdx]]) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];

    if (current === goal) {
      const path: number[] = [current];
      let c = current;
      while (cameFrom[c] !== -1) {
        c = cameFrom[c];
        path.push(c);
      }
      path.reverse();
      return path;
    }

    closed[current] = 1;

    for (const nb of graph.nodes[current].neighbors) {
      if (closed[nb]) continue;
      const tentative = gScore[current] + heuristic(graph, current, nb);
      if (tentative < gScore[nb]) {
        cameFrom[nb] = current;
        gScore[nb] = tentative;
        fScore[nb] = tentative + heuristic(graph, nb, goal);
        if (!open.includes(nb)) open.push(nb);
      }
    }
  }

  return [];
}

/** Convert a node path into world-space waypoints. */
export function pathToPoints(graph: RoadGraph, path: number[]): Vec2[] {
  return path.map((i) => ({ x: graph.nodes[i].x, z: graph.nodes[i].z }));
}

/**
 * Offset a waypoint to the right-hand lane relative to the travel direction,
 * so oncoming AI traffic does not share a centreline.
 */
export function laneOffsetPoint(from: Vec2, to: Vec2, out: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  // Right-hand normal of the travel direction in the XZ plane.
  const nx = -dz / len;
  const nz = dx / len;
  out.x = to.x - nx * TRAFFIC.laneOffset;
  out.z = to.z - nz * TRAFFIC.laneOffset;
  return out;
}

/** True when a world position lies on a road corridor (not a block interior). */
export function isOnRoad(world: { span: number }, x: number, z: number): boolean {
  const cell = WORLD.blockSize + WORLD.roadWidth;
  const halfSpan = world.span / 2;
  const localX = x + halfSpan;
  const localZ = z + halfSpan;
  const modX = ((localX % cell) + cell) % cell;
  const modZ = ((localZ % cell) + cell) % cell;
  const w = WORLD.roadWidth;
  return modX <= w || modZ <= w;
}

/**
 * Pick a random graph node at a usable pursuit-spawn distance from the player:
 * far enough to be off-screen, close enough to reach them quickly.
 */
export function pickSpawnNode(
  graph: RoadGraph,
  player: Vec2,
  minDist: number,
  maxDist: number,
  rng: () => number,
): number {
  const candidates: number[] = [];
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i];
    const d = Math.hypot(n.x - player.x, n.z - player.z);
    if (d >= minDist && d <= maxDist) candidates.push(i);
  }
  if (candidates.length === 0) {
    // Fall back to the furthest node so a spawn always succeeds.
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < graph.nodes.length; i++) {
      const n = graph.nodes[i];
      const d = Math.hypot(n.x - player.x, n.z - player.z);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  return candidates[Math.floor(rng() * candidates.length) % candidates.length];
}

/** Shortest signed angle from `a` to `b`, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
