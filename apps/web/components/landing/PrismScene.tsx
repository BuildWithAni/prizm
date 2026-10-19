"use client";

/**
 * The landing page's 3D glass prism (WebGL via three.js).
 *
 * A triangular prism refracts a white beam into a silver spectrum
 * (white → silver → grey). It spins slowly, tilts toward the mouse, and
 * rotates further as the page scrolls — the scroll value arrives as a
 * MotionValue and is read through a ref, so nothing re-renders per frame.
 */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMotionValueEvent, useReducedMotion, useScroll, type MotionValue } from "framer-motion";
import * as THREE from "three";

const PRISM_RADIUS = 1.15;
const PRISM_LENGTH = 2.45;

interface PrismProps {
  scrollRef: { current: number };
  pointerRef: { current: { x: number; y: number } };
  reduced: boolean;
}

function Prism({ scrollRef, pointerRef, reduced }: PrismProps) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);

  // Geometries are built once (triangle profile facing the camera, extruded in depth).
  const bodyGeo = useMemo(
    () => new THREE.CylinderGeometry(PRISM_RADIUS, PRISM_RADIUS, PRISM_LENGTH, 3, 1, false, Math.PI),
    [],
  );
  const edgeGeo = useMemo(
    () =>
      new THREE.EdgesGeometry(
        new THREE.CylinderGeometry(
          PRISM_RADIUS * 1.01,
          PRISM_RADIUS * 1.01,
          PRISM_LENGTH * 1.02,
          3,
          1,
          false,
          Math.PI,
        ),
      ),
    [],
  );
  useEffect(
    () => () => {
      bodyGeo.dispose();
      edgeGeo.dispose();
    },
    [bodyGeo, edgeGeo],
  );

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const scroll = scrollRef.current; // 0 → 1 across the first screens

    if (!reduced) {
      g.rotation.y += delta * 0.18 + scroll * delta * 1.6; // stately tumble + scroll kick
      g.position.y = Math.sin(t * 0.9) * 0.1 - scroll * 0.7;
    } else {
      g.position.y = -scroll * 0.7;
    }
    // Tilt toward the mouse; add gentle sway and scroll pitch.
    g.rotation.x = THREE.MathUtils.lerp(
      g.rotation.x,
      pointerRef.current.y * 0.2 + (reduced ? 0 : Math.sin(t * 0.5) * 0.07) + scroll * 0.55,
      0.06,
    );
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, pointerRef.current.x * 0.13, 0.06);
    g.scale.setScalar(1 - scroll * 0.16);

    if (core.current && !reduced) {
      core.current.rotation.y -= delta * 0.5; // counter-rotating wire core
      core.current.rotation.x += delta * 0.22;
    }
  });

  return (
    <group ref={group} rotation={[0.1, 0.55, 0]}>
      {/* glass body — a triangular prism (cylinder with 3 sides, apex up) */}
      <mesh rotation={[Math.PI / 2, 0, 0]} geometry={bodyGeo}>
        <meshPhysicalMaterial
          color="#0e140d"
          metalness={0}
          roughness={0.08}
          transmission={0.92}
          thickness={1.6}
          ior={1.45}
          transparent
          emissive="#ffffff"
          emissiveIntensity={0.05}
        />
      </mesh>

      {/* white wireframe edges */}
      <lineSegments rotation={[Math.PI / 2, 0, 0]} geometry={edgeGeo}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.95} />
      </lineSegments>

      {/* glowing wire core */}
      <mesh ref={core} scale={[0.62, 0.62, 0.62]}>
        <octahedronGeometry args={[0.85, 0]} />
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

/** World-fixed light beams (camera-facing planes, additive blending). */
function Beams() {
  const ray = (key: string, props: { position: [number, number, number]; rotation: number; color: string; opacity: number; length?: number }) => (
    <mesh key={key} position={props.position} rotation={[0, 0, props.rotation]}>
      <planeGeometry args={[props.length ?? 3.7, 0.05]} />
      <meshBasicMaterial
        color={props.color}
        transparent
        opacity={props.opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );

  return (
    <group>
      {/* white beam in — reaches the glass left face (edge ≈ x −0.5 at beam height) */}
      {ray("in", { position: [-2.85, 0.12, 0.02], rotation: 0, color: "#ffffff", opacity: 0.7, length: 4.5 })}
      {/* impact glow where the beam meets the glass */}
      <mesh position={[-0.62, 0.12, 0.03]}>
        <circleGeometry args={[0.1, 24]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* spectrum out — fan originates just inside the glass right face */}
      {ray("r1", { position: [2.8, -0.34, 0.02], rotation: -0.17, color: "#ffffff", opacity: 0.85 })}
      {ray("r2", { position: [2.9, 0.06, 0.02], rotation: -0.02, color: "#ffffff", opacity: 0.75 })}
      {ray("r3", { position: [2.75, 0.44, 0.02], rotation: 0.14, color: "#ffffff", opacity: 0.7 })}
    </group>
  );
}

export default function PrismScene({
  className,
  scroll,
  compact = false,
}: {
  className?: string;
  scroll?: MotionValue<number>;
  compact?: boolean;
}) {
  const scrollRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0 });
  const reduced = useReducedMotion() ?? false;
  const internalScroll = useScroll().scrollYProgress;

  useMotionValueEvent(scroll ?? internalScroll, "change", (value) => {
    scrollRef.current = value;
  });

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      pointerRef.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointerRef.current.y = -((event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div className={"prism-scene" + (compact ? " prism-scene-compact" : "") + (className ? ` ${className}` : "")}>
      <div className="prism-glow" aria-hidden="true" />
      <Canvas
        dpr={[1, 1.8]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 0.25, compact ? 7.4 : 6.7], fov: 42 }}
        style={{ pointerEvents: "none" }}
      >
        <ambientLight intensity={0.75} />
        <directionalLight position={[4, 6, 5]} intensity={1.1} />
        <pointLight position={[-3, -1.5, 2.5]} intensity={20} distance={14} color="#ffffff" />
        <pointLight position={[3.2, 1.5, -1]} intensity={12} distance={14} color="#ffffff" />
        <Prism scrollRef={scrollRef} pointerRef={pointerRef} reduced={reduced} />
        <Beams />
      </Canvas>
    </div>
  );
}
