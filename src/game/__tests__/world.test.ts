import { describe, expect, it } from 'vitest';
import { generateWorld, generateParkedVehicles, makeRng } from '../world';
import { findPath, nearestNode, pathToPoints, isOnRoad } from '../navigation';
import { worldToMap, mapToWorld } from '../minimapBridge';
import { WORLD, DRIVING } from '../config';

const world = generateWorld();

describe('seeded world generation', () => {
  it('is deterministic for the same seed', () => {
    const a = generateWorld(1234);
    const b = generateWorld(1234);
    expect(a.buildings.length).toBe(b.buildings.length);
    expect(a.buildings[10]).toEqual(b.buildings[10]);
    expect(a.safehouse).toEqual(b.safehouse);
  });

  it('produces a different layout for a different seed', () => {
    const a = generateWorld(1);
    const b = generateWorld(2);
    // Heights are randomised, so at least some building differs.
    const same = a.buildings.every(
      (bd, i) => b.buildings[i] && bd.height === b.buildings[i].height,
    );
    expect(same).toBe(false);
  });

  it('spans a city of the requested size (400-600m)', () => {
    expect(world.span).toBeGreaterThanOrEqual(400);
    expect(world.span).toBeLessThanOrEqual(600);
  });

  it('includes every required district', () => {
    const kinds = new Set(world.blocks.map((b) => b.district));
    for (const d of [
      'commercial',
      'residential',
      'industrial',
      'park',
      'plaza',
      'safehouse',
      'garage',
    ]) {
      expect(kinds.has(d as never)).toBe(true);
    }
  });

  it('keeps every building clear of the road corridors', () => {
    const cell = WORLD.blockSize + WORLD.roadWidth;
    const half = world.span / 2;
    for (const b of world.buildings) {
      // Check each corner of the footprint lies off-road.
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        const x = b.x + (sx * b.width) / 2;
        const z = b.z + (sz * b.depth) / 2;
        const localX = ((x + half) % cell + cell) % cell;
        const localZ = ((z + half) % cell + cell) % cell;
        // Corners must sit past the road width plus the sidewalk.
        const clearX = localX > WORLD.roadWidth;
        const clearZ = localZ > WORLD.roadWidth;
        expect(clearX || clearZ).toBe(true);
      }
    }
  });

  it('keeps buildings away from the player spawn and mission markers', () => {
    const points = [
      world.playerSpawn,
      world.missionBoard,
      world.safehouse,
      world.garage,
    ];
    for (const p of points) {
      for (const b of world.buildings) {
        const insideX = Math.abs(p.x - b.x) < b.width / 2;
        const insideZ = Math.abs(p.z - b.z) < b.depth / 2;
        expect(insideX && insideZ).toBe(false);
      }
    }
  });

  it('places a starter vehicle within easy reach of the spawn', () => {
    const parked = generateParkedVehicles(world, 0xbeef);
    const starter = parked.find((v) => v.starter);
    expect(starter).toBeDefined();
    const d = Math.hypot(
      starter!.x - world.playerSpawn.x,
      starter!.z - world.playerSpawn.z,
    );
    // Close enough to spot and reach within seconds.
    expect(d).toBeLessThan(12);
    // ...but not so close it overlaps the player capsule on spawn.
    expect(d).toBeGreaterThan(DRIVING.enterRadius * 0.5);
  });

  it('generates parking, props and sidewalk waypoints', () => {
    expect(world.parking.length).toBeGreaterThan(10);
    expect(world.props.length).toBeGreaterThan(50);
    expect(world.sidewalkNodes.length).toBeGreaterThan(100);
  });
});

describe('road graph navigation', () => {
  it('connects every intersection', () => {
    const { nodes } = world.graph;
    expect(nodes.length).toBe(
      (WORLD.gridCols + 1) * (WORLD.gridRows + 1),
    );
    for (const n of nodes) {
      // Corners have 2 neighbours, edges 3, interior 4.
      expect(n.neighbors.length).toBeGreaterThanOrEqual(2);
      expect(n.neighbors.length).toBeLessThanOrEqual(4);
    }
  });

  it('finds a route between any two nodes', () => {
    const { nodes } = world.graph;
    const path = findPath(world.graph, 0, nodes.length - 1);
    expect(path.length).toBeGreaterThan(1);
    expect(path[0]).toBe(0);
    expect(path[path.length - 1]).toBe(nodes.length - 1);
  });

  it('produces a path where every step is an actual edge', () => {
    const path = findPath(world.graph, 3, 40);
    for (let i = 1; i < path.length; i++) {
      expect(world.graph.nodes[path[i - 1]].neighbors).toContain(path[i]);
    }
  });

  it('returns a single node when start equals goal', () => {
    expect(findPath(world.graph, 5, 5)).toEqual([5]);
  });

  it('returns empty for out-of-range nodes instead of throwing', () => {
    expect(findPath(world.graph, -1, 4)).toEqual([]);
    expect(findPath(world.graph, 0, 99999)).toEqual([]);
  });

  it('finds a short route between adjacent intersections', () => {
    const n0 = world.graph.nodes[0];
    const neighbor = n0.neighbors[0];
    expect(findPath(world.graph, 0, neighbor)).toEqual([0, neighbor]);
  });

  it('takes a sensible route length across the city', () => {
    const { nodes } = world.graph;
    const path = findPath(world.graph, 0, nodes.length - 1);
    const pts = pathToPoints(world.graph, path);
    let length = 0;
    for (let i = 1; i < pts.length; i++) {
      length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    }
    const straight = Math.hypot(
      nodes[nodes.length - 1].x - nodes[0].x,
      nodes[nodes.length - 1].z - nodes[0].z,
    );
    // Manhattan routing on a grid is at most ~1.5x the straight line.
    expect(length).toBeGreaterThanOrEqual(straight * 0.99);
    expect(length).toBeLessThan(straight * 1.6);
  });

  it('finds the nearest node to an arbitrary position', () => {
    const target = world.graph.nodes[12];
    const idx = nearestNode(world.graph, target.x + 2, target.z - 3);
    expect(idx).toBe(12);
  });

  it('identifies road versus block interiors', () => {
    const node = world.graph.nodes[8];
    expect(isOnRoad(world, node.x, node.z)).toBe(true);
    const block = world.blocks[7];
    expect(isOnRoad(world, block.x, block.z)).toBe(false);
  });
});

describe('world-to-minimap conversion', () => {
  const half = world.half;

  it('maps the centre of the world to the centre of the map', () => {
    const { u, v } = worldToMap(0, 0, half);
    expect(u).toBeCloseTo(0.5);
    expect(v).toBeCloseTo(0.5);
  });

  it('maps the corners to the map corners', () => {
    expect(worldToMap(-half, -half, half)).toEqual({ u: 0, v: 0 });
    expect(worldToMap(half, half, half)).toEqual({ u: 1, v: 1 });
  });

  it('round-trips through the inverse conversion', () => {
    for (const [x, z] of [
      [0, 0],
      [120, -80],
      [-half, half],
      [37.5, 12.25],
    ]) {
      const { u, v } = worldToMap(x, z, half);
      const back = mapToWorld(u, v, half);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.z).toBeCloseTo(z, 6);
    }
  });

  it('places the safehouse consistently on the map', () => {
    const { u, v } = worldToMap(world.safehouse.x, world.safehouse.z, half);
    expect(u).toBeGreaterThan(0);
    expect(u).toBeLessThan(1);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });
});

describe('rng', () => {
  it('is deterministic and stays in range', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
