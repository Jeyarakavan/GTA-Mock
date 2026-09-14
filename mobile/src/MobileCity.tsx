import { useEffect, useRef } from 'react';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';
import { StyleSheet, View } from 'react-native';
import { generateWorld } from '../../src/game/world';
import { MobileGameController, type MobileTelemetry } from './MobileGame';

const world = generateWorld();

interface Props {
  input: React.MutableRefObject<import('./MobileGame').MobileInput>;
  controller: MobileGameController;
  paused: boolean;
  onTelemetry: (telemetry: MobileTelemetry) => void;
}

export function MobileCity({ input, controller, paused, onTelemetry }: Props) {
  const inputRef = useRef(input);
  const pausedRef = useRef(paused);
  useEffect(() => { inputRef.current = input; pausedRef.current = paused; }, [input, paused]);

  const onContextCreate = async (gl: ExpoWebGLRenderingContext) => {
    const renderer = new Renderer({ gl, antialias: false });
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    renderer.setClearColor('#1a2738');

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#1a2738', 80, 360);
    const camera = new THREE.PerspectiveCamera(58, gl.drawingBufferWidth / gl.drawingBufferHeight, 0.1, 500);
    camera.position.set(world.playerSpawn.x, 12, world.playerSpawn.z + 18);

    scene.add(new THREE.HemisphereLight('#9fb8d8', '#171b24', 2));
    const sun = new THREE.DirectionalLight('#ffd3a1', 2.2);
    sun.position.set(-80, 130, 60);
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(world.half * 2 + 40, world.half * 2 + 40),
      new THREE.MeshStandardMaterial({ color: '#202b35' }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    for (const building of world.buildings) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(building.width, building.height, building.depth),
        new THREE.MeshStandardMaterial({ color: building.color }),
      );
      mesh.position.set(building.x, building.height / 2, building.z);
      scene.add(mesh);
    }

    const roadMaterial = new THREE.MeshStandardMaterial({ color: '#343842' });
    for (const segment of world.graph.segments) {
      const a = world.graph.nodes[segment.a];
      const b = world.graph.nodes[segment.b];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const road = new THREE.Mesh(new THREE.BoxGeometry(segment.axis === 'h' ? length : 10, 0.08, segment.axis === 'h' ? 10 : length), roadMaterial);
      road.position.set((a.x + b.x) / 2, 0.05, (a.z + b.z) / 2);
      scene.add(road);
    }

    const player = new THREE.Vector3(controller.player.x, 1.2, controller.player.z);
    const desiredCamera = new THREE.Vector3();
    const vehicleMeshes = new Map<string, THREE.Mesh>();
    for (const vehicle of controller.vehicles) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.75, 3.8),
        new THREE.MeshStandardMaterial({ color: vehicle.kind === 'sports' ? '#e2603a' : '#5c7f96' }),
      );
      scene.add(mesh);
      vehicleMeshes.set(vehicle.id, mesh);
    }
    const policeMeshes: THREE.Mesh[] = [];
    for (let index = 0; index < 3; index++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.9, 0.8, 4),
        new THREE.MeshStandardMaterial({ color: '#e8eef2' }),
      );
      scene.add(mesh);
      policeMeshes.push(mesh);
    }
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(3.5, 0.18, 8, 24),
      new THREE.MeshBasicMaterial({ color: '#ff5fa2' }),
    );
    marker.rotation.x = Math.PI / 2;
    scene.add(marker);
    let telemetryTimer = 0;
    let last = 0;
    const frame = (time: number) => {
      const dt = Math.min(0.05, (time - last) / 1000 || 0);
      last = time;
      if (!pausedRef.current) controller.update(dt, inputRef.current.current);
      const snapshot = controller.snapshot();
      player.set(snapshot.position.x, 1.2, snapshot.position.z);
      for (const vehicle of snapshot.vehicles) {
        const mesh = vehicleMeshes.get(vehicle.id);
        if (!mesh) continue;
        mesh.position.set(vehicle.position.x, 0.45, vehicle.position.z);
        mesh.rotation.y = vehicle.yaw;
        mesh.visible = !vehicle.playerDriven;
      }
      snapshot.police.forEach((unit, index) => {
        const mesh = policeMeshes[index];
        if (!mesh) return;
        mesh.visible = true;
        mesh.position.set(unit.x, 0.5, unit.z);
      });
      for (let index = snapshot.police.length; index < policeMeshes.length; index++) {
        policeMeshes[index].visible = false;
      }
      const active = controller.mission.activeId
        ? controller.missions.find((mission) => mission.id === controller.mission.activeId)
        : null;
      const objective = active?.objectives[controller.mission.objectiveIndex];
      const markerTarget = objective?.target ?? controller.missions[0]?.start;
      marker.visible = !!markerTarget;
      if (markerTarget) marker.position.set(markerTarget.x, 0.15, markerTarget.z);
      desiredCamera.set(player.x - Math.sin(snapshot.yaw) * 14, 8, player.z - Math.cos(snapshot.yaw) * 14);
      camera.position.lerp(desiredCamera, 0.12);
      camera.lookAt(player.x, 1.2, player.z);
      telemetryTimer += dt;
      if (telemetryTimer >= 0.1) {
        telemetryTimer = 0;
        onTelemetry(snapshot);
      }
      renderer.render(scene, camera);
      gl.endFrameEXP();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  return <View style={StyleSheet.absoluteFill}><GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} /></View>;
}
