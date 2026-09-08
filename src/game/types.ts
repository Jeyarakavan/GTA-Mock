import type { VehicleKindId } from './config';

export type Vec2 = { x: number; z: number };

export type ControlState =
  | 'menu'
  | 'onfoot'
  | 'driving'
  | 'paused'
  | 'arrested';

export type Quality = 'low' | 'high';

export type DistrictKind =
  | 'commercial'
  | 'residential'
  | 'industrial'
  | 'park'
  | 'plaza'
  | 'safehouse'
  | 'garage';

export interface BuildingDef {
  id: string;
  /** Centre position on the ground plane. */
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  /** Rooftop box for silhouette variation; null if flat. */
  roof: { width: number; depth: number; height: number; color: string } | null;
  district: DistrictKind;
  /** Emissive sign strip on the front face. */
  sign: { color: string; label: string } | null;
  windowRows: number;
  windowCols: number;
}

export interface BlockDef {
  col: number;
  row: number;
  /** Centre of the block. */
  x: number;
  z: number;
  size: number;
  district: DistrictKind;
}

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  /** Indices into RoadGraph.nodes. */
  neighbors: number[];
}

export interface RoadSegment {
  a: number;
  b: number;
  /** 'h' horizontal (varies X), 'v' vertical (varies Z). */
  axis: 'h' | 'v';
  length: number;
}

export interface RoadGraph {
  nodes: RoadNode[];
  segments: RoadSegment[];
}

export interface PropDef {
  id: string;
  kind: 'streetlight' | 'tree' | 'bench' | 'sign';
  x: number;
  z: number;
  rotation: number;
  /** Variant scale for visual variety. */
  scale: number;
}

export interface ParkingSpotDef {
  x: number;
  z: number;
  rotation: number;
}

export interface WorldData {
  span: number;
  half: number;
  blocks: BlockDef[];
  buildings: BuildingDef[];
  graph: RoadGraph;
  props: PropDef[];
  parking: ParkingSpotDef[];
  /** Landmark / gameplay anchors. */
  safehouse: Vec2;
  garage: Vec2;
  missionBoard: Vec2;
  parkCenter: Vec2;
  plazaCenter: Vec2;
  /** Player spawn just outside the safehouse door. */
  playerSpawn: Vec2;
  /** Sidewalk waypoint ring for pedestrians. */
  sidewalkNodes: Vec2[];
}

export interface ParkedVehicleDef {
  id: string;
  kind: VehicleKindId;
  x: number;
  z: number;
  rotation: number;
  /** Marks the tutorial car placed next to the safehouse. */
  starter?: boolean;
}

export type MissionId = 'delivery' | 'checkpoint' | 'heat';

export type MissionStatus = 'available' | 'active' | 'completed' | 'failed';

export interface MissionObjectiveMarker {
  x: number;
  z: number;
  radius: number;
  label: string;
}

export interface NotificationItem {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'warn' | 'danger';
  expiresAt: number;
}
