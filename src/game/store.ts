import { create } from 'zustand';
import { PLAYER } from './config';
import { generateParkedVehicles, generateWorld } from './world';
import { buildMissions } from './missions';
import type { MissionDef } from './missions';
import {
  DEFAULT_SAVE,
  loadSave,
  writeSave,
  hasValidSave,
  type SaveData,
} from './save';
import type {
  ControlState,
  MissionId,
  MissionStatus,
  NotificationItem,
  ParkedVehicleDef,
  Quality,
  WorldData,
} from './types';

/** The world is generated once per module load — it is fully deterministic. */
export const world: WorldData = generateWorld();
export const parkedVehicles: ParkedVehicleDef[] = generateParkedVehicles(
  world,
  0xbeef,
);
export const missionDefs: MissionDef[] = buildMissions(world);
export const missionById = (id: MissionId): MissionDef =>
  missionDefs.find((m) => m.id === id)!;

export interface GameState {
  control: ControlState;
  /** Previous control state, so unpausing returns to the right mode. */
  resumeControl: Exclude<ControlState, 'menu' | 'paused'>;
  started: boolean;
  showMap: boolean;
  showHelp: boolean;
  hasSave: boolean;

  health: number;
  cash: number;
  wantedStars: number;

  /** id of the vehicle the player is currently driving. */
  currentVehicleId: string | null;
  /** id of the nearest enterable vehicle, for the interaction prompt. */
  promptVehicleId: string | null;
  /** Free-form interaction prompt (mission board, etc). */
  promptText: string | null;

  /** Speed in m/s, pushed from the sim at a throttled rate for the HUD. */
  speed: number;
  vehicleHealth: number;

  activeMission: MissionId | null;
  objectiveIndex: number;
  objectiveText: string;
  missionTime: number | null;
  missionStatus: Record<MissionId, MissionStatus>;

  notifications: NotificationItem[];

  volume: number;
  muted: boolean;
  quality: Quality;

  /** Bumped to force a full sim remount (New Game / Restart). */
  resetToken: number;

  actions: {
    startGame: (fromSave: boolean) => void;
    returnToMenu: () => void;
    pause: () => void;
    resume: () => void;
    togglePause: () => void;
    setControl: (c: ControlState) => void;
    toggleMap: () => void;
    toggleHelp: () => void;
    setHud: (p: Partial<Pick<GameState, 'speed' | 'vehicleHealth' | 'health' | 'wantedStars'>>) => void;
    setPrompt: (vehicleId: string | null, text: string | null) => void;
    setVehicle: (id: string | null) => void;
    addCash: (amount: number) => void;
    spendCash: (amount: number) => void;
    setMissionHud: (p: {
      activeMission: MissionId | null;
      objectiveIndex: number;
      objectiveText: string;
      missionTime: number | null;
      missionStatus: Record<MissionId, MissionStatus>;
    }) => void;
    notify: (text: string, tone?: NotificationItem['tone']) => void;
    pruneNotifications: () => void;
    setVolume: (v: number) => void;
    setMuted: (m: boolean) => void;
    setQuality: (q: Quality) => void;
    restartMission: () => void;
    saveProgress: (pos?: { x: number; z: number }) => void;
    refreshHasSave: () => void;
  };
}

let notifId = 0;

const initialSave: SaveData = loadSave() ?? DEFAULT_SAVE;

export const useGame = create<GameState>((set, get) => ({
  control: 'menu',
  resumeControl: 'onfoot',
  started: false,
  showMap: false,
  showHelp: false,
  hasSave: hasValidSave(),

  health: PLAYER.maxHealth,
  cash: 0,
  wantedStars: 0,

  currentVehicleId: null,
  promptVehicleId: null,
  promptText: null,

  speed: 0,
  vehicleHealth: 100,

  activeMission: null,
  objectiveIndex: 0,
  objectiveText: '',
  missionTime: null,
  missionStatus: {
    delivery: 'available',
    checkpoint: 'available',
    heat: 'available',
  },

  notifications: [],

  volume: initialSave.volume,
  muted: initialSave.muted,
  quality: initialSave.quality,

  resetToken: 0,

  actions: {
    startGame: (fromSave) => {
      const save = fromSave ? loadSave() : null;
      set((s) => ({
        control: 'onfoot',
        resumeControl: 'onfoot',
        started: true,
        showMap: false,
        showHelp: false,
        health: PLAYER.maxHealth,
        cash: save?.cash ?? 0,
        wantedStars: 0,
        currentVehicleId: null,
        promptVehicleId: null,
        promptText: null,
        speed: 0,
        vehicleHealth: 100,
        activeMission: null,
        objectiveIndex: 0,
        objectiveText: '',
        missionTime: null,
        missionStatus: {
          delivery: save?.completedMissions.includes('delivery')
            ? 'completed'
            : 'available',
          checkpoint: save?.completedMissions.includes('checkpoint')
            ? 'completed'
            : 'available',
          heat: save?.completedMissions.includes('heat')
            ? 'completed'
            : 'available',
        },
        notifications: [],
        resetToken: s.resetToken + 1,
      }));
    },

    returnToMenu: () => {
      set({
        control: 'menu',
        started: false,
        showMap: false,
        showHelp: false,
        currentVehicleId: null,
        promptVehicleId: null,
        promptText: null,
        hasSave: hasValidSave(),
      });
    },

    pause: () => {
      const { control } = get();
      if (control === 'menu' || control === 'paused') return;
      set({
        control: 'paused',
        resumeControl: control === 'driving' ? 'driving' : 'onfoot',
      });
    },

    resume: () => {
      const { control, resumeControl } = get();
      if (control !== 'paused') return;
      set({ control: resumeControl });
    },

    togglePause: () => {
      const { control } = get();
      if (control === 'paused') get().actions.resume();
      else get().actions.pause();
    },

    setControl: (c) => set({ control: c }),

    toggleMap: () => set((s) => ({ showMap: !s.showMap })),
    toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),

    setHud: (p) => set(p),

    setPrompt: (vehicleId, text) => {
      const s = get();
      if (s.promptVehicleId === vehicleId && s.promptText === text) return;
      set({ promptVehicleId: vehicleId, promptText: text });
    },

    setVehicle: (id) =>
      set({
        currentVehicleId: id,
        control: id ? 'driving' : 'onfoot',
        resumeControl: id ? 'driving' : 'onfoot',
        speed: 0,
      }),

    addCash: (amount) => set((s) => ({ cash: s.cash + Math.max(0, amount) })),

    // Balance can never go negative — an arrest fine caps at what you hold.
    spendCash: (amount) =>
      set((s) => ({ cash: Math.max(0, s.cash - Math.max(0, amount)) })),

    setMissionHud: (p) => set(p),

    notify: (text, tone = 'info') => {
      const item: NotificationItem = {
        id: ++notifId,
        text,
        tone,
        expiresAt: performance.now() + 4200,
      };
      set((s) => ({ notifications: [...s.notifications.slice(-3), item] }));
    },

    pruneNotifications: () => {
      const now = performance.now();
      const { notifications } = get();
      if (!notifications.some((n) => n.expiresAt <= now)) return;
      set({ notifications: notifications.filter((n) => n.expiresAt > now) });
    },

    setVolume: (v) => {
      const volume = Math.max(0, Math.min(1, v));
      set({ volume });
      get().actions.saveProgress();
    },

    setMuted: (muted) => {
      set({ muted });
      get().actions.saveProgress();
    },

    setQuality: (quality) => {
      set({ quality });
      get().actions.saveProgress();
    },

    restartMission: () => {
      // Handled by the sim via resetToken; the mission itself restarts clean.
      set((s) => ({ resetToken: s.resetToken + 1, control: 'onfoot' }));
    },

    saveProgress: (pos) => {
      const s = get();
      const completed = (Object.keys(s.missionStatus) as MissionId[]).filter(
        (id) => s.missionStatus[id] === 'completed',
      );
      const prev = loadSave();
      writeSave({
        version: DEFAULT_SAVE.version,
        cash: s.cash,
        completedMissions: completed,
        volume: s.volume,
        muted: s.muted,
        quality: s.quality,
        resume: pos ?? prev?.resume ?? null,
        savedAt: Date.now(),
      });
      set({ hasSave: hasValidSave() });
    },

    refreshHasSave: () => set({ hasSave: hasValidSave() }),
  },
}));

/** Stable selector for the action bag (never changes identity). */
export const useActions = () => useGame((s) => s.actions);
