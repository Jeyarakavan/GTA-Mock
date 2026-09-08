import { WORLD, PALETTE } from './config';
import type {
  BlockDef,
  BuildingDef,
  DistrictKind,
  ParkedVehicleDef,
  ParkingSpotDef,
  PropDef,
  RoadGraph,
  RoadNode,
  RoadSegment,
  Vec2,
  WorldData,
} from './types';

/** Mulberry32 — small, fast, deterministic PRNG. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length) % arr.length];

const range = (rng: () => number, min: number, max: number) =>
  min + rng() * (max - min);

/**
 * The city is a uniform grid: roads run along every grid line, blocks sit
 * between them. Road centrelines are at multiples of (blockSize + roadWidth),
 * which makes world <-> graph conversion trivial and keeps buildings clear of
 * the carriageway by construction.
 */
export const CELL = WORLD.blockSize + WORLD.roadWidth;

/** X/Z coordinate of the road centreline with the given index (0..gridCols). */
export function roadLineCoord(index: number, count: number): number {
  const span = count * CELL + WORLD.roadWidth;
  return -span / 2 + WORLD.roadWidth / 2 + index * CELL;
}

const COMMERCIAL_COLORS = ['#4b5566', '#586074', '#3f4858', '#616b80'];
const RESIDENTIAL_COLORS = ['#7a6a5e', '#8a7565', '#6d5f56', '#94806d'];
const INDUSTRIAL_COLORS = ['#5a5f5c', '#4d5350', '#666b63', '#545a52'];

const SIGN_LABELS = [
  'NOVA',
  'HALCYON',
  'DRIFT',
  'AMBER CO',
  'PIER 9',
  'LUMEN',
  'KESTREL',
  'ORBIT',
  'VANTERA',
  'SALT & PINE',
  'ECHO BAR',
  'ZENITH',
];

const NEONS = [PALETTE.neonTeal, PALETTE.neonPink, PALETTE.neonOrange];

/**
 * Assign a district to each block. Layout is fixed by design (not random) so
 * the city reads coherently: commercial core, residential west, industrial
 * south-east, park and plaza carved out, safehouse + garage on the north edge.
 */
function districtFor(col: number, row: number, cols: number, rows: number): DistrictKind {
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  if (col === 0 && row === 0) return 'safehouse';
  if (col === cols - 1 && row === 0) return 'garage';
  if (col === 1 && row === rows - 1) return 'park';
  if (Math.round(cx) === col && Math.round(cy) === row) return 'plaza';
  const distToCore = Math.abs(col - cx) + Math.abs(row - cy);
  if (distToCore <= 1.6) return 'commercial';
  if (col >= cols - 2 && row >= rows - 2) return 'industrial';
  if (col <= 1) return 'residential';
  if (distToCore <= 2.8) return 'commercial';
  return 'residential';
}

function buildBlocks(cols: number, rows: number): BlockDef[] {
  const blocks: BlockDef[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Block centre sits halfway between two adjacent road centrelines.
      const x = (roadLineCoord(col, cols) + roadLineCoord(col + 1, cols)) / 2;
      const z = (roadLineCoord(row, rows) + roadLineCoord(row + 1, rows)) / 2;
      blocks.push({
        col,
        row,
        x,
        z,
        size: WORLD.blockSize,
        district: districtFor(col, row, cols, rows),
      });
    }
  }
  return blocks;
}

/** Usable footprint inside a block once sidewalks are subtracted. */
const innerSize = () => WORLD.blockSize - WORLD.sidewalkWidth * 2;

function buildingsForBlock(block: BlockDef, rng: () => number): BuildingDef[] {
  const out: BuildingDef[] = [];
  const inner = innerSize();

  if (block.district === 'park' || block.district === 'plaza') {
    return out; // open space — scenery only
  }

  if (block.district === 'safehouse' || block.district === 'garage') {
    // A single low landmark structure centred in the block.
    const isSafe = block.district === 'safehouse';
    const w = inner * 0.52;
    const d = inner * 0.42;
    out.push({
      id: `${block.district}-main`,
      x: block.x,
      z: block.z + inner * 0.12,
      width: w,
      depth: d,
      height: isSafe ? 9 : 7.5,
      color: isSafe ? '#7c6a86' : '#5f6a6e',
      roof: {
        width: w * 0.5,
        depth: d * 0.5,
        height: 2.4,
        color: '#4a4550',
      },
      district: block.district,
      sign: {
        color: isSafe ? PALETTE.neonTeal : PALETTE.neonOrange,
        label: isSafe ? 'SAFEHOUSE' : 'GARAGE',
      },
      windowRows: 3,
      windowCols: 5,
    });
    return out;
  }

  // Subdivide the block into a small grid of separated footprints.
  const cells =
    block.district === 'industrial' ? 1 + Math.floor(rng() * 2) : 2;
  const cellSize = inner / cells;
  const gap = 3.0; // guarantees separated footprints

  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      if (cells > 1 && rng() < 0.12) continue; // occasional courtyard gap

      const cxCenter = block.x - inner / 2 + cellSize * (i + 0.5);
      const czCenter = block.z - inner / 2 + cellSize * (j + 0.5);
      const maxW = cellSize - gap;
      const w = maxW * range(rng, 0.78, 1.0);
      const d = maxW * range(rng, 0.78, 1.0);

      let height: number;
      let color: string;
      if (block.district === 'commercial') {
        height = range(rng, 22, 54);
        color = pick(rng, COMMERCIAL_COLORS);
      } else if (block.district === 'industrial') {
        height = range(rng, 8, 16);
        color = pick(rng, INDUSTRIAL_COLORS);
      } else {
        height = range(rng, 10, 22);
        color = pick(rng, RESIDENTIAL_COLORS);
      }

      const hasRoof = rng() < 0.55;
      const wantsSign = block.district === 'commercial' && rng() < 0.4;

      out.push({
        id: `b-${block.col}-${block.row}-${i}-${j}`,
        x: cxCenter,
        z: czCenter,
        width: w,
        depth: d,
        height,
        color,
        roof: hasRoof
          ? {
              width: w * range(rng, 0.3, 0.6),
              depth: d * range(rng, 0.3, 0.6),
              height: range(rng, 1.6, 4.5),
              color: '#3d434e',
            }
          : null,
        district: block.district,
        sign: wantsSign
          ? { color: pick(rng, NEONS), label: pick(rng, SIGN_LABELS) }
          : null,
        windowRows: Math.max(2, Math.floor(height / 4)),
        windowCols: Math.max(2, Math.floor(w / 3.2)),
      });
    }
  }
  return out;
}

/** Build the road graph: a node at every intersection, edges along grid lines. */
function buildGraph(cols: number, rows: number): RoadGraph {
  const nodes: RoadNode[] = [];
  const index = (c: number, r: number) => r * (cols + 1) + c;

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      nodes.push({
        id: index(c, r),
        x: roadLineCoord(c, cols),
        z: roadLineCoord(r, rows),
        neighbors: [],
      });
    }
  }

  const segments: RoadSegment[] = [];
  const link = (a: number, b: number, axis: 'h' | 'v') => {
    const na = nodes[a];
    const nb = nodes[b];
    na.neighbors.push(b);
    nb.neighbors.push(a);
    segments.push({ a, b, axis, length: Math.hypot(nb.x - na.x, nb.z - na.z) });
  };

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) link(index(c, r), index(c + 1, r), 'h');
  }
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r < rows; r++) link(index(c, r), index(c, r + 1), 'v');
  }

  return { nodes, segments };
}

/** Streetlights, trees and benches placed along sidewalks and in the park. */
function buildProps(
  blocks: BlockDef[],
  cols: number,
  rows: number,
  rng: () => number,
): PropDef[] {
  const props: PropDef[] = [];
  let n = 0;
  const halfBlock = WORLD.blockSize / 2;
  const lightInset = halfBlock + WORLD.sidewalkWidth * 0.5;

  for (const block of blocks) {
    // Streetlights at the block corners, on the sidewalk.
    const corners: Array<[number, number]> = [
      [block.x - lightInset, block.z - lightInset],
      [block.x + lightInset, block.z - lightInset],
      [block.x - lightInset, block.z + lightInset],
      [block.x + lightInset, block.z + lightInset],
    ];
    for (const [x, z] of corners) {
      props.push({
        id: `sl-${n++}`,
        kind: 'streetlight',
        x,
        z,
        rotation: Math.atan2(block.z - z, block.x - x),
        scale: 1,
      });
    }

    if (block.district === 'park') {
      for (let i = 0; i < 22; i++) {
        props.push({
          id: `tr-${n++}`,
          kind: 'tree',
          x: block.x + range(rng, -halfBlock * 0.8, halfBlock * 0.8),
          z: block.z + range(rng, -halfBlock * 0.8, halfBlock * 0.8),
          rotation: rng() * Math.PI * 2,
          scale: range(rng, 0.85, 1.45),
        });
      }
      for (let i = 0; i < 6; i++) {
        props.push({
          id: `bn-${n++}`,
          kind: 'bench',
          x: block.x + range(rng, -halfBlock * 0.6, halfBlock * 0.6),
          z: block.z + range(rng, -halfBlock * 0.6, halfBlock * 0.6),
          rotation: rng() * Math.PI * 2,
          scale: 1,
        });
      }
    } else if (block.district === 'plaza') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        props.push({
          id: `tr-${n++}`,
          kind: 'tree',
          x: block.x + Math.cos(a) * halfBlock * 0.62,
          z: block.z + Math.sin(a) * halfBlock * 0.62,
          rotation: a,
          scale: 1.1,
        });
        props.push({
          id: `bn-${n++}`,
          kind: 'bench',
          x: block.x + Math.cos(a + 0.4) * halfBlock * 0.38,
          z: block.z + Math.sin(a + 0.4) * halfBlock * 0.38,
          rotation: a + Math.PI / 2,
          scale: 1,
        });
      }
    } else if (block.district === 'residential') {
      for (let i = 0; i < 3; i++) {
        props.push({
          id: `tr-${n++}`,
          kind: 'tree',
          x: block.x + range(rng, -halfBlock, halfBlock),
          z: block.z + (rng() < 0.5 ? -1 : 1) * lightInset,
          rotation: rng() * Math.PI * 2,
          scale: range(rng, 0.8, 1.1),
        });
      }
    }
  }

  // Fictional roadside signs at a few intersections.
  for (let i = 0; i < 10; i++) {
    const c = Math.floor(rng() * (cols + 1));
    const r = Math.floor(rng() * (rows + 1));
    props.push({
      id: `sg-${n++}`,
      kind: 'sign',
      x: roadLineCoord(c, cols) + (rng() < 0.5 ? -1 : 1) * (WORLD.roadWidth / 2 + 1.5),
      z: roadLineCoord(r, rows) + (rng() < 0.5 ? -1 : 1) * (WORLD.roadWidth / 2 + 1.5),
      rotation: rng() * Math.PI * 2,
      scale: 1,
    });
  }

  return props;
}

/** Parking bays hugging the kerb on each block edge. */
function buildParking(blocks: BlockDef[], rng: () => number): ParkingSpotDef[] {
  const spots: ParkingSpotDef[] = [];
  const offset = WORLD.blockSize / 2 + WORLD.sidewalkWidth + 1.6;
  for (const block of blocks) {
    if (block.district === 'park') continue;
    const count = 2;
    for (let i = 0; i < count; i++) {
      const t = (i + 1) / (count + 1) - 0.5;
      const along = t * WORLD.blockSize * 0.7;
      if (rng() < 0.5) {
        spots.push({ x: block.x + along, z: block.z - offset, rotation: 0 });
        spots.push({ x: block.x + along, z: block.z + offset, rotation: Math.PI });
      } else {
        spots.push({ x: block.x - offset, z: block.z + along, rotation: Math.PI / 2 });
        spots.push({ x: block.x + offset, z: block.z + along, rotation: -Math.PI / 2 });
      }
    }
  }
  return spots;
}

/** Sidewalk waypoints — a ring around each block for pedestrians to walk. */
function buildSidewalkNodes(blocks: BlockDef[]): Vec2[] {
  const out: Vec2[] = [];
  const r = WORLD.blockSize / 2 + WORLD.sidewalkWidth * 0.5;
  for (const block of blocks) {
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      out.push({ x: block.x - r + t * 2 * r, z: block.z - r });
      out.push({ x: block.x + r, z: block.z - r + t * 2 * r });
      out.push({ x: block.x + r - t * 2 * r, z: block.z + r });
      out.push({ x: block.x - r, z: block.z + r - t * 2 * r });
    }
  }
  return out;
}

export function generateWorld(seed: number = WORLD.seed): WorldData {
  const rng = makeRng(seed);
  const { gridCols: cols, gridRows: rows } = WORLD;
  const span = cols * CELL + WORLD.roadWidth;

  const blocks = buildBlocks(cols, rows);
  const buildings: BuildingDef[] = [];
  for (const block of blocks) buildings.push(...buildingsForBlock(block, rng));

  const graph = buildGraph(cols, rows);
  const props = buildProps(blocks, cols, rows, rng);
  const parking = buildParking(blocks, rng);
  const sidewalkNodes = buildSidewalkNodes(blocks);

  const find = (d: DistrictKind) => blocks.find((b) => b.district === d)!;
  const safeBlock = find('safehouse');
  const garageBlock = find('garage');
  const parkBlock = find('park');
  const plazaBlock = find('plaza');

  // The landmark building sits at +12% of the inner block depth, so the
  // usable anchor is the forecourt in front of it — never inside the walls.
  // Respawns, mission objectives and map markers all key off these points.
  const frontOffset = WORLD.blockSize / 2 - WORLD.sidewalkWidth;
  const safehouse: Vec2 = { x: safeBlock.x, z: safeBlock.z - frontOffset };
  // Player spawns on the street-side sidewalk in front of the safehouse.
  const playerSpawn: Vec2 = {
    x: safeBlock.x,
    z: safeBlock.z - (WORLD.blockSize / 2 + WORLD.sidewalkWidth * 0.5),
  };
  // Mission board sits on the same sidewalk, a few metres along.
  const missionBoard: Vec2 = {
    x: safeBlock.x + 10,
    z: safeBlock.z - (WORLD.blockSize / 2 + WORLD.sidewalkWidth * 0.5),
  };

  return {
    span,
    half: span / 2,
    blocks,
    buildings,
    graph,
    props,
    parking,
    safehouse,
    garage: { x: garageBlock.x, z: garageBlock.z - frontOffset },
    missionBoard,
    parkCenter: { x: parkBlock.x, z: parkBlock.z },
    plazaCenter: { x: plazaBlock.x, z: plazaBlock.z },
    playerSpawn,
    sidewalkNodes,
  };
}

/**
 * Parked vehicles. The starter car is placed on the kerb a few metres from the
 * player spawn so the first vehicle is unmissable within seconds of starting.
 */
export function generateParkedVehicles(world: WorldData, seed: number): ParkedVehicleDef[] {
  const rng = makeRng(seed ^ 0x9e37);
  const out: ParkedVehicleDef[] = [];

  // Starter car: on the road beside the safehouse sidewalk.
  out.push({
    id: 'veh-starter',
    kind: 'compact',
    x: world.playerSpawn.x + 5.5,
    z: world.playerSpawn.z - (WORLD.sidewalkWidth + 2.2),
    rotation: 0,
    starter: true,
  });

  // A sports car outside the garage as a reward-feeling pickup.
  out.push({
    id: 'veh-sports-garage',
    kind: 'sports',
    x: world.garage.x,
    z: world.garage.z - (WORLD.blockSize / 2 + WORLD.sidewalkWidth + 3),
    rotation: 0,
  });

  // Scatter the rest across parking bays, skipping those near the spawn.
  const shuffled = [...world.parking].sort(() => rng() - 0.5);
  let placed = 0;
  for (const spot of shuffled) {
    if (placed >= 14) break;
    const dSpawn = Math.hypot(spot.x - world.playerSpawn.x, spot.z - world.playerSpawn.z);
    if (dSpawn < 22) continue;
    out.push({
      id: `veh-${placed}`,
      kind: rng() < 0.32 ? 'sports' : 'compact',
      x: spot.x,
      z: spot.z,
      rotation: spot.rotation,
    });
    placed++;
  }

  return out;
}
