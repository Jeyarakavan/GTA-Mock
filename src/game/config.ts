/**
 * Central tunable configuration for Neon District: Street Run.
 * All gameplay magic numbers live here so they can be balanced in one place.
 */

export const WORLD = {
  /** Seed for deterministic city layout. */
  seed: 20260908,
  /** Number of blocks per axis in the city grid. */
  gridCols: 6,
  gridRows: 6,
  /** Size of one city block (building footprint area), metres. */
  blockSize: 68,
  /** Width of a road corridor, metres. */
  roadWidth: 16,
  /** Sidewalk width on each side of a road, metres. */
  sidewalkWidth: 3,
  /** Height of the invisible boundary wall. */
  boundaryHeight: 24,
  /** Extra margin outside the outermost road before the boundary. */
  boundaryMargin: 14,
};

/** Total city extent (metres) derived from the grid. */
export const CITY_SPAN =
  WORLD.gridCols * WORLD.blockSize + (WORLD.gridCols + 1) * WORLD.roadWidth;

export const PLAYER = {
  radius: 0.38,
  height: 1.75,
  /** Half-height of the capsule's cylindrical section. */
  capsuleHalfHeight: 0.5,
  walkSpeed: 4.2,
  sprintSpeed: 8.0,
  acceleration: 42,
  deceleration: 34,
  jumpSpeed: 6.4,
  gravity: -24,
  /** Max angular speed the visual model turns to face movement (rad/s). */
  turnSpeed: 12,
  /** Fall below this Y and we respawn the player. */
  fallResetY: -18,
  maxHealth: 100,
  eyeHeight: 1.5,
};

export const CAMERA = {
  footDistance: 6.5,
  footHeight: 1.7,
  carDistance: 11.5,
  carHeight: 3.0,
  fov: 62,
  /** Camera smoothing half-life in seconds (lower = snappier). */
  positionHalfLife: 0.09,
  targetHalfLife: 0.07,
  minPitch: -0.35,
  maxPitch: 1.15,
  mouseSensitivity: 0.0024,
  /** Keep the camera at least this far from a wall it collides with. */
  collisionPadding: 0.45,
  minDistance: 1.6,
};

export type VehicleKindId = 'compact' | 'sports' | 'police';

export interface VehicleSpec {
  id: VehicleKindId;
  label: string;
  /** Chassis half-extents [x (width/2), y (height/2), z (length/2)]. */
  halfExtents: [number, number, number];
  mass: number;
  /** Peak forward engine force (N). */
  engineForce: number;
  reverseForce: number;
  brakeForce: number;
  /** Max speed in m/s. */
  maxSpeed: number;
  maxReverseSpeed: number;
  /** Steering rate in rad/s at low speed. */
  steerRate: number;
  /** Lateral grip coefficient — higher sticks harder. */
  grip: number;
  handbrakeGrip: number;
  /** Linear drag applied against forward motion. */
  drag: number;
  rollingResistance: number;
  bodyColor: string;
  accentColor: string;
  maxHealth: number;
}

export const VEHICLE_SPECS: Record<VehicleKindId, VehicleSpec> = {
  compact: {
    id: 'compact',
    label: 'Kestrel Civic',
    halfExtents: [0.88, 0.42, 1.95],
    mass: 1150,
    engineForce: 26000,
    reverseForce: 12000,
    brakeForce: 30000,
    maxSpeed: 24,
    maxReverseSpeed: 8,
    steerRate: 1.75,
    grip: 7.5,
    handbrakeGrip: 1.5,
    drag: 0.42,
    rollingResistance: 2.4,
    bodyColor: '#5c7f96',
    accentColor: '#2b3b47',
    maxHealth: 100,
  },
  sports: {
    id: 'sports',
    label: 'Vantera GT',
    halfExtents: [0.94, 0.34, 2.15],
    mass: 1020,
    engineForce: 40000,
    reverseForce: 13000,
    brakeForce: 34000,
    maxSpeed: 38,
    maxReverseSpeed: 9,
    steerRate: 2.0,
    grip: 8.8,
    handbrakeGrip: 1.2,
    drag: 0.34,
    rollingResistance: 2.0,
    bodyColor: '#e2603a',
    accentColor: '#2a1c18',
    maxHealth: 90,
  },
  police: {
    id: 'police',
    label: 'District Patrol',
    halfExtents: [0.92, 0.44, 2.1],
    mass: 1300,
    engineForce: 36000,
    reverseForce: 13500,
    brakeForce: 33000,
    maxSpeed: 32,
    maxReverseSpeed: 8,
    steerRate: 1.85,
    grip: 8.2,
    handbrakeGrip: 1.4,
    drag: 0.38,
    rollingResistance: 2.2,
    bodyColor: '#e8eef2',
    accentColor: '#16202b',
    maxHealth: 130,
  },
};

export const DRIVING = {
  /** Steering authority falls off with speed down to this multiplier. */
  minSteerFactor: 0.28,
  steerFalloffSpeed: 26,
  /** Must be below this speed (m/s) to shift into reverse. */
  reverseThreshold: 1.2,
  /** Must be below this speed to exit the vehicle. */
  exitMaxSpeed: 6.0,
  /** Interaction radius for entering a vehicle. */
  enterRadius: 4.2,
  /** Collision impulse above which damage is applied. */
  damageImpulseThreshold: 2600,
  damagePerImpulse: 0.0055,
  /** Seconds between damage events on the same vehicle. */
  damageCooldown: 0.35,
  /** Vehicle recovery (R) cooldown, seconds. */
  recoverCooldown: 3,
  /** Auto-upright if roll exceeds this many radians for a while. */
  flippedAngle: 1.15,
};

export const WANTED = {
  maxStars: 3,
  /** Seconds undetected before one star decays. */
  decaySeconds: 12,
  /** Minimum seconds between two heat-gain events (anti-spam). */
  gainCooldown: 3.0,
  /** Impulse above which a police-car ram counts as a heat event. */
  ramImpulseThreshold: 4200,
  /** Police detection radius by star level. */
  detectRadius: [0, 55, 75, 95],
  /** How many police units chase per star level. */
  unitsPerStar: [0, 1, 2, 3],
  /** Distance from player at which police spawn (out of view). */
  spawnDistance: 95,
  spawnMinDistance: 60,
  /** Seconds a cop must stay within arrestRadius of a slow player to arrest. */
  arrestSeconds: 4,
  arrestRadius: 7,
  /** Player must be under this speed for arrest progress to accrue. */
  arrestMaxPlayerSpeed: 3.5,
  arrestCashPenalty: 250,
  /** Route recalculation interval (seconds). */
  repathInterval: 1.2,
};

export const TRAFFIC = {
  high: { cars: 16, peds: 26 },
  low: { cars: 7, peds: 12 },
  /** Cruise speed range for civilian traffic (m/s). */
  minSpeed: 7,
  maxSpeed: 13,
  /** Slow down when a car is within this distance ahead. */
  lookAhead: 13,
  /** Lane offset from road centreline. */
  laneOffset: 4.0,
  /** Distance beyond which AI updates run at reduced frequency. */
  farDistance: 120,
  farUpdateHz: 6,
  /** Don't spawn within this distance of the player. */
  playerClearance: 45,
  /** Reset a car that has been stuck this long. */
  stuckSeconds: 5,
  pedSpeed: 1.35,
  pedFleeSpeed: 3.4,
  /** Pedestrians flee cars within this radius travelling faster than fleeSpeed. */
  pedDangerRadius: 9,
  pedDangerSpeed: 8,
};

export const MISSION = {
  /** Radius of a mission start marker. */
  startRadius: 4.5,
  /** Radius of a generic objective zone. */
  zoneRadius: 6.5,
  checkpointRadius: 8.0,
  /** Player must be under this speed to "stop within" a zone. */
  stopSpeed: 2.0,
};

export const PHYSICS = {
  /** Fixed simulation timestep (seconds) — 60 Hz. */
  timeStep: 1 / 60,
  /** Clamp for a single frame delta after tab-out / stalls. */
  maxDelta: 0.1,
  gravity: [0, -9.81 * 2.2, 0] as [number, number, number],
};

export const RENDER = {
  high: {
    shadows: true,
    shadowMapSize: 2048,
    maxPixelRatio: 1.75,
    fogNear: 60,
    fogFar: 340,
    streetlights: true,
    trees: true,
  },
  low: {
    shadows: false,
    shadowMapSize: 1024,
    maxPixelRatio: 1.0,
    fogNear: 40,
    fogFar: 200,
    streetlights: false,
    trees: true,
  },
};

export const PALETTE = {
  asphalt: '#4a4f59',
  roadLine: '#d8cfa8',
  sidewalk: '#8b8e97',
  ground: '#55655c',
  parkGrass: '#5c8262',
  plaza: '#7a7670',
  skyTop: '#25355e',
  skyBottom: '#ffb083',
  fog: '#6b7396',
  sun: '#ffdcb4',
  ambient: '#5f7ba8',
  neonTeal: '#2ee6c8',
  neonPink: '#ff5fa2',
  neonOrange: '#ff9d4d',
} as const;

export const SAVE_KEY = 'neon-district-save';
export const SAVE_VERSION = 3;
