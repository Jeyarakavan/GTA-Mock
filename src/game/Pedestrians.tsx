import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  writePedestrianMatrices,
  type PedestrianSystem,
} from './systems/pedestrians';
import { TRAFFIC } from './config';

const MAX_PEDS = TRAFFIC.high.peds;

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();
const color = new THREE.Color();

/**
 * Renders all pedestrians in four instanced meshes (body, head, two legs).
 * The system owns the data; this component only writes matrices each frame.
 */
export function Pedestrians({ system }: { system: PedestrianSystem }) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const legsL = useRef<THREE.InstancedMesh>(null);
  const legsR = useRef<THREE.InstancedMesh>(null);

  useFrame(() => {
    if (!bodies.current || !heads.current || !legsL.current || !legsR.current) {
      return;
    }
    writePedestrianMatrices(
      system.peds,
      dummy,
      bodies.current,
      heads.current,
      legsL.current,
      legsR.current,
      color,
    );
  });

  return (
    <group>
      <instancedMesh
        ref={bodies}
        args={[boxGeo, undefined, MAX_PEDS]}
        castShadow
        frustumCulled={false}
      >
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        ref={heads}
        args={[boxGeo, undefined, MAX_PEDS]}
        frustumCulled={false}
      >
        <meshLambertMaterial color="#c99878" />
      </instancedMesh>
      <instancedMesh
        ref={legsL}
        args={[boxGeo, undefined, MAX_PEDS]}
        frustumCulled={false}
      >
        <meshLambertMaterial color="#333d4f" />
      </instancedMesh>
      <instancedMesh
        ref={legsR}
        args={[boxGeo, undefined, MAX_PEDS]}
        frustumCulled={false}
      >
        <meshLambertMaterial color="#333d4f" />
      </instancedMesh>
    </group>
  );
}
