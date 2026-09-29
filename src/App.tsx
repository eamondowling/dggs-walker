import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { DGGSPlanet } from './dggs/planet';
import { BipedCharacter } from './character/biped';
import { SphericalCharacterController, CameraMode, CharacterOrientationMode } from './character/controller';
import { DGGSCell } from './dggs/icosahedron';
import { DGGSOverlay } from './components/DGGSOverlay';
import { soundEngine } from './audio/sound';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  // HUD State
  const [currentCell, setCurrentCell] = useState<DGGSCell | null>(null);
  const [telemetry, setTelemetry] = useState({
    lat: 90,
    lon: 0,
    speed: 0,
  });
  const [beaconsActivated, setBeaconsActivated] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>('curved_horizon');
  const [orientationMode, setOrientationMode] = useState<CharacterOrientationMode>('tile_normal');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [wireframeDepth, setWireframeDepth] = useState({
    d0: true,
    d1: true,
    d2: true,
    d3: true,
  });

  // Controller reference
  const controllerRef = useRef<SphericalCharacterController | null>(null);
  const planetRef = useRef<DGGSPlanet | null>(null);
  const characterRef = useRef<BipedCharacter | null>(null);

  // Suppresses beacon proximity activation for a moment after spawning/resetting
  // on top of one (the North Pole beacon sits exactly at the spawn point).
  const spawnGraceRef = useRef(1.2);

  // Mouse & Touch interaction state
  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });

  // Virtual touch controls for mobile
  const [touchActive, setTouchActive] = useState(false);
  const touchActiveRef = useRef(false);
  const joystickCenterRef = useRef<{ x: number; y: number } | null>(null);
  const joystickTouchIdRef = useRef<number | null>(null);
  const [joystickThumb, setJoystickThumb] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const joystickThumbRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060c1e); // Radiant deep cosmos navy

    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;

    const camera = new THREE.PerspectiveCamera(
      65,
      width / height,
      0.1,
      2000
    );

    // 2. Renderer (Standard, reliable WebGL setup)
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    containerRef.current.appendChild(renderer.domElement);

    // 3. Lighting - Crisp, balanced full-spectrum illumination
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 1.4);
    scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.4);
    sunLight.position.set(160, 200, 120);
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 1.0);
    fillLight.position.set(-160, -80, -140);
    scene.add(fillLight);

    // Glowing Sun sphere in cosmos
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(14, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffedd5 })
    );
    sunMesh.position.set(160, 200, 120);
    scene.add(sunMesh);

    // 4. Background Starfield
    const starCount = 2200;
    const starGeom = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const radius = 400 + Math.random() * 300;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);

      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = radius * Math.cos(phi);

      const tint = Math.random();
      if (tint > 0.8) {
        starColors[i * 3] = 1.0;
        starColors[i * 3 + 1] = 0.85;
        starColors[i * 3 + 2] = 0.7;
      } else if (tint > 0.5) {
        starColors[i * 3] = 0.75;
        starColors[i * 3 + 1] = 0.9;
        starColors[i * 3 + 2] = 1.0;
      } else {
        starColors[i * 3] = 1.0;
        starColors[i * 3 + 1] = 1.0;
        starColors[i * 3 + 2] = 1.0;
      }
    }
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const starMat = new THREE.PointsMaterial({
      vertexColors: true,
      size: 2.8,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
    });
    const starPoints = new THREE.Points(starGeom, starMat);
    starPoints.frustumCulled = false;
    scene.add(starPoints);

    // 5. DGGS Planet
    const planet = new DGGSPlanet(42);
    planetRef.current = planet;
    scene.add(planet.group);

    // 6. Red Sphere Biped Character
    const character = new BipedCharacter();
    characterRef.current = character;
    scene.add(character.group);

    // 7. Spherical Controller
    const controller = new SphericalCharacterController(character, planet, camera);
    controllerRef.current = controller;
    scene.add(controller.particles.mesh);

    // Connect audio callbacks to controller
    const origOnFootstep = character.onFootstep;
    character.onFootstep = (pos, isLeft) => {
      if (origOnFootstep) origOnFootstep(pos, isLeft);
      soundEngine.playFootstep(isLeft);
    };

    // 8. Event Listeners (Keyboard)
    const activeKeys = new Set<string>();

    const handleKeyDown = (e: KeyboardEvent) => {
      soundEngine.notifyUserInteraction();
      // Prevent default scrolling for game keys
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      activeKeys.add(e.code);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      activeKeys.delete(e.code);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Mouse Look / Orbit
    const handleMouseDown = (e: MouseEvent) => {
      soundEngine.notifyUserInteraction();
      // Allow drag with either left button (0) or right button (2)
      if (e.button === 0 || e.button === 2) {
        isDraggingRef.current = true;
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        const deltaX = e.clientX - lastMousePosRef.current.x;
        const deltaY = e.clientY - lastMousePosRef.current.y;
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
        controller.handlePointerMove(deltaX, deltaY);
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      controller.handleWheel(e.deltaY);
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('contextmenu', handleContextMenu);

    // Resize handling with ResizeObserver
    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth || window.innerWidth;
      const h = containerRef.current.clientHeight || window.innerHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(containerRef.current);
    window.addEventListener('resize', handleResize);

    // 9. Main Animation Loop
    let lastTime = performance.now();
    let animFrameId: number;
    let telemetryThrottle = 0;

    const animate = (currentTime: number) => {
      animFrameId = requestAnimationFrame(animate);

      const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      // Update input state from activeKeys:
      // W/S = forward / backward, A/D = turn left / right (not lateral strafe)
      let f = 0;
      let turn = 0;
      if (activeKeys.has('KeyW') || activeKeys.has('ArrowUp')) f += 1;
      if (activeKeys.has('KeyS') || activeKeys.has('ArrowDown')) f -= 1;
      if (activeKeys.has('KeyA') || activeKeys.has('ArrowLeft')) turn -= 1;
      if (activeKeys.has('KeyD') || activeKeys.has('ArrowRight')) turn += 1;

      // If virtual touch joystick is active, combine
      if (touchActiveRef.current && (joystickThumbRef.current.x !== 0 || joystickThumbRef.current.y !== 0)) {
        f += -joystickThumbRef.current.y;
        turn += joystickThumbRef.current.x;
      }

      controller.input.forward = THREE.MathUtils.clamp(f, -1, 1);
      controller.input.turn = THREE.MathUtils.clamp(turn, -1, 1);
      controller.input.sprint = activeKeys.has('ShiftLeft') || activeKeys.has('ShiftRight');
      controller.input.jump = activeKeys.has('Space');

      // Update controller & physics
      controller.update(delta);

      // Update planet beacons & rotating crystals
      planet.updateBeacons(delta, currentTime / 1000);

      // Check proximity to the 12 icosahedral base beacons
      if (spawnGraceRef.current > 0) {
        spawnGraceRef.current -= delta;
      } else {
        const charPos = controller.currentPosition;
        for (const beacon of planet.beacons) {
          if (!beacon.activated) {
            const dist = charPos.distanceTo(beacon.position);
            if (dist < 4.2) {
              const activated = planet.activateBeacon(beacon.index);
              if (activated) {
                const count = planet.beacons.filter((b) => b.activated).length;
                setBeaconsActivated(count);
              }
            }
          }
        }
      }

      // Update Active DGGS Cell
      const cell = planet.dggs.findCellAtPosition(controller.unitPosition);
      planet.updateActiveCell(cell);

      // Telemetry update throttled to ~15fps for UI efficiency
      telemetryThrottle += delta;
      if (telemetryThrottle > 0.065) {
        telemetryThrottle = 0;
        setCurrentCell(cell);

        const lat = Math.asin(controller.unitPosition.y) * (180 / Math.PI);
        const lon = Math.atan2(controller.unitPosition.z, controller.unitPosition.x) * (180 / Math.PI);

        setTelemetry({
          lat,
          lon,
          speed: controller.currentSpeed,
        });
      }

      renderer.render(scene, camera);
    };

    animFrameId = requestAnimationFrame(animate);

    // Initial cell update
    const initialCell = planet.dggs.findCellAtPosition(controller.unitPosition);
    setCurrentCell(initialCell);
    planet.updateActiveCell(initialCell);

    // Cleanup
    return () => {
      cancelAnimationFrame(animFrameId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('resize', handleResize);

      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // Handlers for HUD
  const handleSelectCameraMode = useCallback((mode: CameraMode) => {
    setCameraMode(mode);
    if (controllerRef.current) {
      controllerRef.current.setCameraMode(mode);
    }
  }, []);

  const handleSelectOrientationMode = useCallback((mode: CharacterOrientationMode) => {
    setOrientationMode(mode);
    if (controllerRef.current) {
      controllerRef.current.setOrientationMode(mode);
    }
  }, []);

  const handleToggleWireframe = useCallback((depth: 'd0' | 'd1' | 'd2' | 'd3') => {
    setWireframeDepth((prev) => {
      const next = { ...prev, [depth]: !prev[depth] };
      if (planetRef.current) {
        planetRef.current.setWireframeVisibility(next.d0, next.d1, next.d2, next.d3);
      }
      return next;
    });
  }, []);

  const handleToggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      soundEngine.setEnabled(next);
      return next;
    });
  }, []);

  const handleResetPosition = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.resetPosition();
      spawnGraceRef.current = 1.2;
    }
  }, []);

  // Touch screen handlers (for mobile/tablet support)
  const handleTouchStart = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      // Left half of screen initiates virtual joystick
      if (touch.clientX < window.innerWidth * 0.45 && joystickTouchIdRef.current === null) {
        joystickTouchIdRef.current = touch.identifier;
        joystickCenterRef.current = { x: touch.clientX, y: touch.clientY };
        touchActiveRef.current = true;
        setTouchActive(true);
        joystickThumbRef.current = { x: 0, y: 0 };
        setJoystickThumb({ x: 0, y: 0 });
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === joystickTouchIdRef.current && joystickCenterRef.current) {
        const dx = touch.clientX - joystickCenterRef.current.x;
        const dy = touch.clientY - joystickCenterRef.current.y;
        const maxDist = 45;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const normDist = Math.min(1.0, dist / maxDist);
        const angle = Math.atan2(dy, dx);

        const thumb = {
          x: Math.cos(angle) * normDist,
          y: Math.sin(angle) * normDist,
        };
        joystickThumbRef.current = thumb;
        setJoystickThumb(thumb);
      } else if (touch.clientX > window.innerWidth * 0.45 && controllerRef.current) {
        // Right side touch rotates camera
        controllerRef.current.handlePointerMove(-touch.clientX * 0.01, -touch.clientY * 0.01);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === joystickTouchIdRef.current) {
        joystickTouchIdRef.current = null;
        joystickCenterRef.current = null;
        touchActiveRef.current = false;
        setTouchActive(false);
        joystickThumbRef.current = { x: 0, y: 0 };
        setJoystickThumb({ x: 0, y: 0 });
      }
    }
  };

  return (
    <div
      className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none touch-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* 3D WebGL Canvas */}
      <div ref={containerRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />

      {/* Semantic DOM HUD Layer */}
      <DGGSOverlay
        currentCell={currentCell}
        latitude={telemetry.lat}
        longitude={telemetry.lon}
        speed={telemetry.speed}
        beaconsActivated={beaconsActivated}
        totalBeacons={12}
        cameraMode={cameraMode}
        onSelectCameraMode={handleSelectCameraMode}
        orientationMode={orientationMode}
        onSelectOrientationMode={handleSelectOrientationMode}
        wireframeDepth={wireframeDepth}
        onToggleWireframe={handleToggleWireframe}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onResetPosition={handleResetPosition}
      />

      {/* Mobile Virtual Touch Controls */}
      <div className="absolute bottom-16 left-6 pointer-events-auto md:hidden">
        {touchActive && joystickCenterRef.current && (
          <div
            className="fixed w-24 h-24 rounded-full border-2 border-white/20 bg-slate-900/60 backdrop-blur-sm -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              left: `${joystickCenterRef.current.x}px`,
              top: `${joystickCenterRef.current.y}px`,
            }}
          >
            <div
              className="absolute w-10 h-10 rounded-full bg-rose-500 shadow-lg -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `calc(50% + ${joystickThumb.x * 32}px)`,
                top: `calc(50% + ${joystickThumb.y * 32}px)`,
              }}
            />
          </div>
        )}
      </div>

      {/* Mobile Jump & Sprint action buttons */}
      <div className="absolute bottom-16 right-6 pointer-events-auto flex flex-col gap-3 md:hidden">
        <button
          onClick={() => {
            if (controllerRef.current && controllerRef.current.isGrounded) {
              controllerRef.current.input.jump = true;
              setTimeout(() => {
                if (controllerRef.current) controllerRef.current.input.jump = false;
              }, 100);
            }
          }}
          className="w-14 h-14 rounded-full bg-rose-600 active:bg-rose-700 text-white font-semibold text-xs shadow-xl border border-white/20 flex items-center justify-center cursor-pointer"
        >
          JUMP
        </button>
      </div>
    </div>
  );
}
