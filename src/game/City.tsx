import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { PALETTE, RENDER, WORLD } from './config';
import { CELL, roadLineCoord } from './world';
import { world } from './store';
import type { Quality } from './types';

/** Shared geometries/materials — created once, reused by every instance. */
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
const coneGeo = new THREE.ConeGeometry(1, 1, 7);
const planeGeo = new THREE.PlaneGeometry(1, 1);

const dummy = new THREE.Object3D();
const color = new THREE.Color();

/**
 * All static buildings in a handful of instanced meshes, grouped by colour so
 * a single material serves each group.
 */
function Buildings({ quality }: { quality: Quality }) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const roofs = useRef<THREE.InstancedMesh>(null);

  const { buildings, roofList } = useMemo(() => {
    return {
      buildings: world.buildings,
      roofList: world.buildings.filter((b) => b.roof !== null),
    };
  }, []);

  useLayoutEffect(() => {
    const mesh = bodies.current;
    if (!mesh) return;
    buildings.forEach((b, i) => {
      dummy.position.set(b.x, b.height / 2, b.z);
      dummy.scale.set(b.width, b.height, b.depth);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(b.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [buildings]);

  useLayoutEffect(() => {
    const mesh = roofs.current;
    if (!mesh) return;
    roofList.forEach((b, i) => {
      const r = b.roof!;
      dummy.position.set(b.x, b.height + r.height / 2, b.z);
      dummy.scale.set(r.width, r.height, r.depth);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(r.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [roofList]);

  const shadows = RENDER[quality].shadows;

  return (
    <>
      <instancedMesh
        ref={bodies}
        args={[boxGeo, undefined, buildings.length]}
        castShadow={shadows}
        receiveShadow={shadows}
        frustumCulled={false}
      >
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        ref={roofs}
        args={[boxGeo, undefined, roofList.length]}
        castShadow={shadows}
        frustumCulled={false}
      >
        <meshLambertMaterial />
      </instancedMesh>
      <BuildingWindows />
      <BuildingSigns />
      {/* One static collider per building. Rapier handles these cheaply as
          fixed cuboids and they are what stops the player and cars. */}
      <RigidBody type="fixed" colliders={false}>
        {buildings.map((b) => (
          <CuboidCollider
            key={b.id}
            args={[b.width / 2, b.height / 2, b.depth / 2]}
            position={[b.x, b.height / 2, b.z]}
          />
        ))}
      </RigidBody>
    </>
  );
}

/** Emissive window grids, instanced as thin lit quads on each facade. */
function BuildingWindows() {
  const mesh = useRef<THREE.InstancedMesh>(null);

  const quads = useMemo(() => {
    const out: Array<{
      x: number;
      y: number;
      z: number;
      ry: number;
      lit: boolean;
    }> = [];
    let n = 0;
    for (const b of world.buildings) {
      if (b.district === 'industrial') continue;
      const rows = Math.min(b.windowRows, 12);
      const cols = Math.min(b.windowCols, 6);
      // Front (-Z) and back (+Z) facades only — keeps the count sane.
      for (const side of [-1, 1] as const) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (n > 6000) break;
            const y = 2.4 + (r / rows) * (b.height - 3.4);
            const x = b.x + ((c + 0.5) / cols - 0.5) * b.width * 0.82;
            out.push({
              x,
              y,
              z: b.z + side * (b.depth / 2 + 0.06),
              ry: side === -1 ? Math.PI : 0,
              // Deterministic "is this window lit" from position.
              lit: ((r * 7 + c * 13 + Math.floor(b.x)) % 10) < 4,
            });
            n++;
          }
        }
      }
    }
    return out;
  }, []);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    quads.forEach((q, i) => {
      dummy.position.set(q.x, q.y, q.z);
      dummy.rotation.set(0, q.ry, 0);
      dummy.scale.set(1.15, 1.0, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, color.set(q.lit ? '#ffd9a0' : '#2b3340'));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [quads]);

  return (
    <instancedMesh
      ref={mesh}
      args={[planeGeo, undefined, quads.length]}
      frustumCulled={false}
    >
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/** Original fictional neon signs on commercial facades. */
function BuildingSigns() {
  const signs = useMemo(
    () => world.buildings.filter((b) => b.sign !== null),
    [],
  );

  return (
    <group>
      {signs.map((b) => (
        <mesh
          key={`sign-${b.id}`}
          position={[b.x, b.height * 0.72, b.z - b.depth / 2 - 0.12]}
        >
          <planeGeometry args={[b.width * 0.6, 1.5]} />
          <meshBasicMaterial
            color={b.sign!.color}
            toneMapped={false}
            transparent
            opacity={0.92}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Roads, sidewalks and markings. Drawn as flat geometry a few centimetres
 * above the ground plane; the ground itself carries the single collider.
 */
function Streets() {
  const { gridCols: cols, gridRows: rows } = WORLD;
  const span = world.span;
  const w = WORLD.roadWidth;

  const roadColor = useMemo(() => new THREE.Color(PALETTE.asphalt), []);
  const walkColor = useMemo(() => new THREE.Color(PALETTE.sidewalk), []);

  const dashes = useRef<THREE.InstancedMesh>(null);

  const dashList = useMemo(() => {
    const out: Array<{ x: number; z: number; ry: number }> = [];
    const step = 6;
    // Centre dashes down every road corridor.
    for (let c = 0; c <= cols; c++) {
      const x = roadLineCoord(c, cols);
      for (let z = -span / 2 + 4; z < span / 2 - 4; z += step) {
        out.push({ x, z, ry: 0 });
      }
    }
    for (let r = 0; r <= rows; r++) {
      const z = roadLineCoord(r, rows);
      for (let x = -span / 2 + 4; x < span / 2 - 4; x += step) {
        out.push({ x, z, ry: Math.PI / 2 });
      }
    }
    return out;
  }, [cols, rows, span]);

  useLayoutEffect(() => {
    const m = dashes.current;
    if (!m) return;
    dashList.forEach((d, i) => {
      dummy.position.set(d.x, 0.045, d.z);
      dummy.rotation.set(-Math.PI / 2, 0, d.ry);
      dummy.scale.set(0.28, 2.6, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [dashList]);

  return (
    <group>
      {/* Sidewalk slabs: one raised pad per block. */}
      {world.blocks.map((b) => (
        <mesh
          key={`walk-${b.col}-${b.row}`}
          position={[b.x, 0.06, b.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[b.size, b.size]} />
          <meshLambertMaterial color={walkColor} />
        </mesh>
      ))}

      {/* Road corridors. */}
      {Array.from({ length: cols + 1 }, (_, c) => (
        <mesh
          key={`rv-${c}`}
          position={[roadLineCoord(c, cols), 0.03, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[w, span]} />
          <meshLambertMaterial color={roadColor} />
        </mesh>
      ))}
      {Array.from({ length: rows + 1 }, (_, r) => (
        <mesh
          key={`rh-${r}`}
          position={[0, 0.032, roadLineCoord(r, rows)]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[span, w]} />
          <meshLambertMaterial color={roadColor} />
        </mesh>
      ))}

      <instancedMesh
        ref={dashes}
        args={[planeGeo, undefined, dashList.length]}
        frustumCulled={false}
      >
        <meshBasicMaterial color={PALETTE.roadLine} toneMapped={false} />
      </instancedMesh>

      {/* Parking bay outlines. */}
      {world.parking.map((p, i) => (
        <mesh
          key={`park-${i}`}
          position={[p.x, 0.05, p.z]}
          rotation={[-Math.PI / 2, 0, p.rotation]}
        >
          <planeGeometry args={[2.4, 5]} />
          <meshBasicMaterial
            color="#c9c2a4"
            transparent
            opacity={0.22}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Park lawn and plaza paving. */}
      {world.blocks
        .filter((b) => b.district === 'park' || b.district === 'plaza')
        .map((b) => (
          <mesh
            key={`open-${b.col}-${b.row}`}
            position={[b.x, 0.07, b.z]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
          >
            <planeGeometry args={[b.size * 0.94, b.size * 0.94]} />
            <meshLambertMaterial
              color={b.district === 'park' ? PALETTE.parkGrass : PALETTE.plaza}
            />
          </mesh>
        ))}
    </group>
  );
}

/** Streetlights, trees, benches and roadside signs — all instanced. */
function Props({ quality }: { quality: Quality }) {
  const settings = RENDER[quality];

  const lights = useMemo(
    () => (settings.streetlights ? world.props.filter((p) => p.kind === 'streetlight') : []),
    [settings.streetlights],
  );
  const trees = useMemo(
    () => (settings.trees ? world.props.filter((p) => p.kind === 'tree') : []),
    [settings.trees],
  );
  const benches = useMemo(() => world.props.filter((p) => p.kind === 'bench'), []);
  const signs = useMemo(() => world.props.filter((p) => p.kind === 'sign'), []);

  const poles = useRef<THREE.InstancedMesh>(null);
  const lamps = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const canopies = useRef<THREE.InstancedMesh>(null);
  const benchMesh = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const p = poles.current;
    const l = lamps.current;
    if (!p || !l) return;
    lights.forEach((s, i) => {
      dummy.position.set(s.x, 2.6, s.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.08, 5.2, 0.08);
      dummy.updateMatrix();
      p.setMatrixAt(i, dummy.matrix);

      dummy.position.set(s.x, 5.3, s.z);
      dummy.scale.set(0.42, 0.22, 0.42);
      dummy.updateMatrix();
      l.setMatrixAt(i, dummy.matrix);
    });
    p.instanceMatrix.needsUpdate = true;
    l.instanceMatrix.needsUpdate = true;
    p.computeBoundingSphere();
    l.computeBoundingSphere();
  }, [lights]);

  useLayoutEffect(() => {
    const t = trunks.current;
    const c = canopies.current;
    if (!t || !c) return;
    trees.forEach((s, i) => {
      dummy.position.set(s.x, 1.1 * s.scale, s.z);
      dummy.rotation.set(0, s.rotation, 0);
      dummy.scale.set(0.16, 2.2 * s.scale, 0.16);
      dummy.updateMatrix();
      t.setMatrixAt(i, dummy.matrix);

      dummy.position.set(s.x, 3.3 * s.scale, s.z);
      dummy.scale.set(1.5 * s.scale, 3.2 * s.scale, 1.5 * s.scale);
      dummy.updateMatrix();
      c.setMatrixAt(i, dummy.matrix);
      c.setColorAt(i, color.set(i % 3 === 0 ? '#3f6b48' : '#4f7a52'));
    });
    t.instanceMatrix.needsUpdate = true;
    c.instanceMatrix.needsUpdate = true;
    if (c.instanceColor) c.instanceColor.needsUpdate = true;
    t.computeBoundingSphere();
    c.computeBoundingSphere();
  }, [trees]);

  useLayoutEffect(() => {
    const m = benchMesh.current;
    if (!m) return;
    benches.forEach((s, i) => {
      dummy.position.set(s.x, 0.45, s.z);
      dummy.rotation.set(0, s.rotation, 0);
      dummy.scale.set(1.6, 0.12, 0.5);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [benches]);

  return (
    <group>
      <instancedMesh
        ref={poles}
        args={[boxGeo, undefined, Math.max(1, lights.length)]}
        frustumCulled={false}
      >
        <meshLambertMaterial color="#3c4149" />
      </instancedMesh>
      <instancedMesh
        ref={lamps}
        args={[boxGeo, undefined, Math.max(1, lights.length)]}
        frustumCulled={false}
      >
        <meshBasicMaterial color="#ffd9a8" toneMapped={false} />
      </instancedMesh>

      <instancedMesh
        ref={trunks}
        args={[cylGeo, undefined, Math.max(1, trees.length)]}
        castShadow={settings.shadows}
        frustumCulled={false}
      >
        <meshLambertMaterial color="#4a3a2e" />
      </instancedMesh>
      <instancedMesh
        ref={canopies}
        args={[coneGeo, undefined, Math.max(1, trees.length)]}
        castShadow={settings.shadows}
        frustumCulled={false}
      >
        <meshLambertMaterial />
      </instancedMesh>

      <instancedMesh
        ref={benchMesh}
        args={[boxGeo, undefined, Math.max(1, benches.length)]}
        frustumCulled={false}
      >
        <meshLambertMaterial color="#6b5240" />
      </instancedMesh>

      {signs.map((s) => (
        <group key={s.id} position={[s.x, 0, s.z]} rotation={[0, s.rotation, 0]}>
          <mesh position={[0, 1.2, 0]}>
            <boxGeometry args={[0.08, 2.4, 0.08]} />
            <meshLambertMaterial color="#4a4f58" />
          </mesh>
          <mesh position={[0, 2.5, 0]}>
            <boxGeometry args={[1.5, 0.55, 0.06]} />
            <meshBasicMaterial color={PALETTE.neonTeal} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Ground plane, invisible boundary walls, and a visible boundary rim. */
function GroundAndBounds() {
  const half = world.half;
  const outer = half + WORLD.boundaryMargin;
  const h = WORLD.boundaryHeight;

  return (
    <>
      <RigidBody type="fixed" colliders={false} userData={{ kind: 'ground' }}>
        {/* Ground: a large thin cuboid, its top face exactly at y = 0. */}
        <CuboidCollider args={[outer + 60, 0.5, outer + 60]} position={[0, -0.5, 0]} />
        {/* Four boundary walls keep the player inside the district. */}
        <CuboidCollider args={[outer, h / 2, 1]} position={[0, h / 2, -outer]} />
        <CuboidCollider args={[outer, h / 2, 1]} position={[0, h / 2, outer]} />
        <CuboidCollider args={[1, h / 2, outer]} position={[-outer, h / 2, 0]} />
        <CuboidCollider args={[1, h / 2, outer]} position={[outer, h / 2, 0]} />
      </RigidBody>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[(outer + 60) * 2, (outer + 60) * 2]} />
        <meshLambertMaterial color={PALETTE.ground} />
      </mesh>

      {/* Visible, believable edge: a lit sea wall around the district. */}
      {(
        [
          [0, -outer, outer * 2, 1.6, 0],
          [0, outer, outer * 2, 1.6, 0],
          [-outer, 0, 1.6, outer * 2, 0],
          [outer, 0, 1.6, outer * 2, 0],
        ] as const
      ).map(([x, z, sx, sz], i) => (
        <group key={`bound-${i}`}>
          <mesh position={[x, 1.1, z]}>
            <boxGeometry args={[sx, 2.2, sz]} />
            <meshLambertMaterial color="#4d5360" />
          </mesh>
          <mesh position={[x, 2.3, z]}>
            <boxGeometry args={[sx * 0.99, 0.12, sz * 0.99]} />
            <meshBasicMaterial color={PALETTE.neonTeal} toneMapped={false} />
          </mesh>
        </group>
      ))}

      {/* Water beyond the wall to explain the boundary. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0]}>
        <planeGeometry args={[(outer + 220) * 2, (outer + 220) * 2]} />
        <meshLambertMaterial color="#22384f" />
      </mesh>
    </>
  );
}

/** Landmark markers for the safehouse and garage so they read at a glance. */
function Landmarks() {
  return (
    <group>
      <mesh position={[world.safehouse.x, 12.5, world.safehouse.z]}>
        <boxGeometry args={[3, 3, 3]} />
        <meshBasicMaterial color={PALETTE.neonTeal} toneMapped={false} />
      </mesh>
      <mesh position={[world.garage.x, 11, world.garage.z]}>
        <boxGeometry args={[3, 3, 3]} />
        <meshBasicMaterial color={PALETTE.neonOrange} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function City({ quality }: { quality: Quality }) {
  return (
    <group>
      <GroundAndBounds />
      <Streets />
      <Buildings quality={quality} />
      <Props quality={quality} />
      <Landmarks />
    </group>
  );
}

export { CELL };
