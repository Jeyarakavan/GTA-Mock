import { MISSION, PLAYER, VEHICLE_SPECS, WANTED, type VehicleKindId } from '../../src/game/config';
import { buildMissions, canStart, failMission, initialRuntime, isObjectiveSatisfied, startMission, tickTimer, advanceObjective, type MissionRuntime } from '../../src/game/missions';
import { addHeat, initialWanted, tickWanted, type WantedState } from '../../src/game/wanted';
import { generateParkedVehicles, generateWorld } from '../../src/game/world';
import type { MissionId, Vec2 } from '../../src/game/types';

export interface MobileInput {
  forward: number;
  strafe: number;
  sprint: boolean;
  jump: boolean;
  handbrake: boolean;
  lookDX: number;
  lookDY: number;
}

export interface MobileVehicle {
  id: string;
  kind: VehicleKindId;
  position: Vec2;
  yaw: number;
  speed: number;
  health: number;
  playerDriven: boolean;
}

export interface MobileTelemetry {
  position: Vec2;
  yaw: number;
  speed: number;
  health: number;
  cash: number;
  wanted: number;
  driving: boolean;
  vehicleHealth: number;
  activeMission: MissionId | null;
  objective: string;
  missionTime: number | null;
  prompt: string | null;
  police: Vec2[];
  vehicles: MobileVehicle[];
  notification: string | null;
}

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export class MobileGameController {
  readonly world = generateWorld();
  readonly missions = buildMissions(this.world);
  readonly vehicles: MobileVehicle[] = generateParkedVehicles(this.world, 0xbeef).map((v) => ({
    id: v.id,
    kind: v.kind,
    position: { x: v.x, z: v.z },
    yaw: v.rotation,
    speed: 0,
    health: VEHICLE_SPECS[v.kind].maxHealth,
    playerDriven: false,
  }));
  player: Vec2 = { ...this.world.playerSpawn };
  yaw = 0;
  verticalSpeed = 0;
  onGround = true;
  health = PLAYER.maxHealth;
  cash = 0;
  mission: MissionRuntime = initialRuntime();
  wanted: WantedState = initialWanted();
  vehicleId: string | null = null;
  police: Vec2[] = [];
  notification: string | null = null;
  private notificationTime = 0;
  private savePosition: Vec2 | null = null;

  update(dt: number, input: MobileInput) {
    this.notificationTime = Math.max(0, this.notificationTime - dt);
    if (this.notificationTime === 0) this.notification = null;
    this.yaw -= input.lookDX * 0.004;
    input.lookDX = 0;
    input.lookDY = 0;

    const vehicle = this.currentVehicle();
    if (vehicle) {
      const spec = VEHICLE_SPECS[vehicle.kind];
      vehicle.speed += input.forward * spec.engineForce / spec.mass * dt;
      vehicle.speed *= Math.pow(0.985, dt * 60);
      vehicle.speed = clamp(vehicle.speed, -spec.maxReverseSpeed, spec.maxSpeed);
      if (input.handbrake) vehicle.speed *= Math.pow(0.78, dt * 60);
      vehicle.yaw -= input.strafe * (0.9 + Math.min(1, Math.abs(vehicle.speed) / 12)) * dt;
      vehicle.position.x += Math.sin(vehicle.yaw) * vehicle.speed * dt;
      vehicle.position.z += Math.cos(vehicle.yaw) * vehicle.speed * dt;
      this.player = { ...vehicle.position };
      this.updateWanted(dt, vehicle.speed);
    } else {
      const speed = input.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
      const length = Math.hypot(input.forward, input.strafe);
      const forward = length > 1 ? input.forward / length : input.forward;
      const strafe = length > 1 ? input.strafe / length : input.strafe;
      this.player.x += (strafe * Math.cos(this.yaw) + forward * Math.sin(this.yaw)) * speed * dt;
      this.player.z += (forward * Math.cos(this.yaw) - strafe * Math.sin(this.yaw)) * speed * dt;
      if (input.jump && this.onGround) {
        this.verticalSpeed = PLAYER.jumpSpeed;
        this.onGround = false;
      }
      this.verticalSpeed += PLAYER.gravity * dt;
      if (this.verticalSpeed < 0) {
        this.verticalSpeed = 0;
        this.onGround = true;
      }
      this.updateWanted(dt, 0);
    }

    this.player.x = clamp(this.player.x, -this.world.half + 2, this.world.half - 2);
    this.player.z = clamp(this.player.z, -this.world.half + 2, this.world.half - 2);
    this.updateMission(dt);
    this.updatePolice(dt);
  }

  interact() {
    const vehicle = this.currentVehicle();
    if (vehicle) {
      if (Math.abs(vehicle.speed) > 2) {
        this.say('Slow down before getting out');
        return;
      }
      vehicle.playerDriven = false;
      this.vehicleId = null;
      this.say('Exited vehicle');
      return;
    }

    const mission = this.missions.find((def) => canStart(this.mission, def.id) && distance(this.player, def.start) <= MISSION.startRadius);
    if (mission) {
      this.mission = startMission(this.mission, mission);
      if (mission.startingWanted) this.wanted = addHeat(this.wanted, mission.startingWanted, true).state;
      this.say(`Mission started: ${mission.title}`);
      return;
    }

    const nearest = this.nearestVehicle();
    if (nearest) {
      nearest.playerDriven = true;
      this.vehicleId = nearest.id;
      if (nearest.kind !== 'police') this.wanted = addHeat(this.wanted, 1).state;
      this.say(`Entered ${VEHICLE_SPECS[nearest.kind].label}`);
    }
  }

  recover() {
    const vehicle = this.currentVehicle();
    if (!vehicle) return;
    vehicle.speed = 0;
    vehicle.yaw = this.yaw;
    vehicle.health = Math.max(25, vehicle.health);
    this.say('Vehicle recovered');
  }

  loadSave(cash: number, completed: MissionId[], resume: Vec2 | null) {
    this.cash = cash;
    this.mission = initialRuntime(completed);
    this.savePosition = resume;
    if (resume) this.player = { ...resume };
  }

  getSave() {
    return { cash: this.cash, completedMissions: Object.keys(this.mission.status).filter((id) => this.mission.status[id as MissionId] === 'completed') as MissionId[], resume: this.savePosition ?? this.player };
  }

  snapshot(): MobileTelemetry {
    const vehicle = this.currentVehicle();
    const def = this.mission.activeId ? this.missions.find((m) => m.id === this.mission.activeId) : null;
    const objective = def?.objectives[this.mission.objectiveIndex];
    return {
      position: { ...this.player },
      yaw: vehicle?.yaw ?? this.yaw,
      speed: vehicle?.speed ?? 0,
      health: this.health,
      cash: this.cash,
      wanted: this.wanted.stars,
      driving: !!vehicle,
      vehicleHealth: vehicle ? (vehicle.health / VEHICLE_SPECS[vehicle.kind].maxHealth) * 100 : 100,
      activeMission: this.mission.activeId,
      objective: objective?.text ?? 'Explore the district',
      missionTime: this.mission.activeId && Number.isFinite(this.mission.timeRemaining) ? this.mission.timeRemaining : null,
      prompt: this.prompt(),
      police: this.police.map((position) => ({ ...position })),
      vehicles: this.vehicles.map((item) => ({ ...item, position: { ...item.position } })),
      notification: this.notification,
    };
  }

  private currentVehicle() {
    return this.vehicleId ? this.vehicles.find((vehicle) => vehicle.id === this.vehicleId) ?? null : null;
  }

  private nearestVehicle() {
    return this.vehicles.find((vehicle) => !vehicle.playerDriven && distance(this.player, vehicle.position) <= 5) ?? null;
  }

  private prompt() {
    const vehicle = this.currentVehicle();
    if (vehicle) return Math.abs(vehicle.speed) <= 2 ? 'Tap Action to exit' : 'Slow down to exit';
    if (this.missions.some((mission) => canStart(this.mission, mission.id) && distance(this.player, mission.start) <= MISSION.startRadius)) return 'Tap Action to start mission';
    if (this.nearestVehicle()) return 'Tap Action to enter vehicle';
    return null;
  }

  private updateMission(dt: number) {
    if (!this.mission.activeId) return;
    const def = this.missions.find((mission) => mission.id === this.mission.activeId)!;
    const timer = tickTimer(this.mission, dt);
    this.mission = timer.runtime;
    if (timer.expired) {
      this.mission = failMission(this.mission, def.id);
      this.say(`${def.title} failed`, 'danger');
      return;
    }
    const objective = def.objectives[this.mission.objectiveIndex];
    if (!objective || !isObjectiveSatisfied(objective, { playerX: this.player.x, playerZ: this.player.z, speed: Math.abs(this.currentVehicle()?.speed ?? 0), inVehicle: !!this.vehicleId, wanted: this.wanted.stars })) return;
    const result = advanceObjective(this.mission, def);
    this.mission = result.runtime;
    if (result.completed) {
      this.cash += result.reward;
      this.savePosition = { ...this.player };
      this.say(`${def.title} complete: +$${result.reward}`, 'success');
    } else this.say('Objective complete', 'success');
  }

  private updateWanted(dt: number, speed: number) {
    const detected = this.police.some((unit) => distance(unit, this.player) < 28);
    const arrestable = this.police.some((unit) => distance(unit, this.player) < WANTED.arrestRadius) && speed < WANTED.arrestMaxPlayerSpeed;
    const result = tickWanted(this.wanted, { dt, detected, arrestable });
    this.wanted = result.state;
    if (result.arrested) {
      this.cash = Math.max(0, this.cash - WANTED.arrestCashPenalty);
      this.player = { ...this.world.playerSpawn };
      this.vehicleId = null;
      for (const item of this.vehicles) item.playerDriven = false;
      if (this.mission.activeId) this.mission = failMission(this.mission, this.mission.activeId);
      this.say('Busted - returned to safehouse', 'danger');
    }
  }

  private updatePolice(dt: number) {
    if (this.wanted.stars === 0) {
      this.police = [];
      return;
    }
    while (this.police.length < this.wanted.stars) {
      const angle = this.police.length * 2.1 + 0.7;
      this.police.push({ x: this.player.x + Math.cos(angle) * 45, z: this.player.z + Math.sin(angle) * 45 });
    }
    this.police = this.police.slice(0, this.wanted.stars);
    for (const unit of this.police) {
      const dx = this.player.x - unit.x;
      const dz = this.player.z - unit.z;
      const length = Math.hypot(dx, dz) || 1;
      unit.x += (dx / length) * 8 * dt;
      unit.z += (dz / length) * 8 * dt;
    }
  }

  private say(text: string, _tone: 'info' | 'success' | 'warn' | 'danger' = 'info') {
    this.notification = text;
    this.notificationTime = 4;
  }
}
