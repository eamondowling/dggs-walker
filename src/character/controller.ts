import * as THREE from 'three';
import { BipedCharacter } from './biped';
import { DGGSPlanet, NET_WORLD_OFFSET } from '../dggs/planet';
import { NET_EDGE_CHORD, NET_LAYOUT_CENTER } from '../dggs/net';

export type CameraMode = 'curved_horizon' | 'close_third' | 'wide_panoramic' | 'orbital_planet' | 'icosahedral_net';
export type CharacterOrientationMode = 'tile_normal' | 'camera_top' | 'radial_gravity';

export interface CameraPreset {
  distance: number;
  height: number;
  pitch: number; // degrees
  fov: number;
}

export const CAMERA_PRESETS: Record<CameraMode, CameraPreset> = {
  curved_horizon: { distance: 6.2, height: 2.6, pitch: 20, fov: 65 },
  close_third: { distance: 3.8, height: 1.6, pitch: 15, fov: 60 },
  wide_panoramic: { distance: 11.5, height: 4.8, pitch: 24, fov: 72 },
  orbital_planet: { distance: 120.0, height: 35.0, pitch: 35, fov: 50 },
  icosahedral_net: { distance: 220.0, height: 0, pitch: 0, fov: 55 },
};

export class FootstepParticles {
  public mesh: THREE.Points;
  private maxParticles = 60;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private alphas: Float32Array;
  private velocities: THREE.Vector3[] = [];
  private lifetimes: number[] = [];
  private nextIndex = 0;

  constructor() {
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);
    this.alphas = new Float32Array(this.maxParticles);

    for (let i = 0; i < this.maxParticles; i++) {
      this.velocities.push(new THREE.Vector3());
      this.lifetimes.push(0);
      this.sizes[i] = 0.25;
      this.colors[i * 3] = 0.95;
      this.colors[i * 3 + 1] = 0.85;
      this.colors[i * 3 + 2] = 0.7;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geom.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.35,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.Points(geom, mat);
  }

  public emit(pos: THREE.Vector3, up: THREE.Vector3) {
    for (let p = 0; p < 3; p++) {
      const idx = this.nextIndex;
      this.nextIndex = (this.nextIndex + 1) % this.maxParticles;

      this.positions[idx * 3] = pos.x + (Math.random() - 0.5) * 0.15;
      this.positions[idx * 3 + 1] = pos.y + (Math.random() - 0.5) * 0.15;
      this.positions[idx * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.15;

      const tangent = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .cross(up)
        .normalize()
        .multiplyScalar(0.4 + Math.random() * 0.4);

      const vel = tangent.addScaledVector(up, 0.5 + Math.random() * 0.4);
      this.velocities[idx].copy(vel);
      this.lifetimes[idx] = 1.0;
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  public update(delta: number) {
    const posAttr = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.lifetimes[i] > 0) {
        this.lifetimes[i] -= delta * 2.2;
        if (this.lifetimes[i] <= 0) {
          this.lifetimes[i] = 0;
          this.positions[i * 3 + 1] = -9999;
        } else {
          this.positions[i * 3] += this.velocities[i].x * delta;
          this.positions[i * 3 + 1] += this.velocities[i].y * delta;
          this.positions[i * 3 + 2] += this.velocities[i].z * delta;
        }
      }
    }
    posAttr.needsUpdate = true;
  }
}

export class SphericalCharacterController {
  public character: BipedCharacter;
  public planet: DGGSPlanet;
  public camera: THREE.PerspectiveCamera;
  public particles: FootstepParticles;

  // Spherical Coordinates & Vectors
  public unitPosition: THREE.Vector3 = new THREE.Vector3(0, 1, 0); // Normalized direction from planet center
  public currentPosition: THREE.Vector3 = new THREE.Vector3();
  public localUp: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  public characterUp: THREE.Vector3 = new THREE.Vector3(0, 1, 0); // Effective orientation UP vector
  public activeTileNormal: THREE.Vector3 = new THREE.Vector3(0, 1, 0); // Normal of the active DGGS tile
  public forwardHeading: THREE.Vector3 = new THREE.Vector3(0, 0, 1); // Tangent forward vector
  public velocityTangent: THREE.Vector3 = new THREE.Vector3();

  // Orientation Mode: 'tile_normal' | 'camera_top' | 'radial_gravity'
  public orientationMode: CharacterOrientationMode = 'tile_normal';

  // Physics
  public verticalHeight = 0;
  public verticalVelocity = 0;
  public isGrounded = true;
  public gravity = 28.0;
  public jumpForce = 9.8;
  public walkSpeed = 5.2;
  public sprintSpeed = 9.8;
  public currentSpeed = 0;

  // Camera Settings
  public cameraMode: CameraMode = 'curved_horizon';
  public cameraAzimuth = 0; // Mouse yaw orbit around character
  public cameraPitch = 20 * (Math.PI / 180);
  public cameraDistanceOffset = 0;
  public currentCameraPos: THREE.Vector3 = new THREE.Vector3();
  public currentLookAt: THREE.Vector3 = new THREE.Vector3();
  public currentCameraQuat: THREE.Quaternion = new THREE.Quaternion();

  // Input State
  public input = {
    forward: 0, // +1 = forward (W), -1 = backward (S)
    turn: 0,    // -1 = turn left (A), +1 = turn right (D)
    sprint: false,
    jump: false,
  };

  private angularTurnSpeed = 0;

  constructor(character: BipedCharacter, planet: DGGSPlanet, camera: THREE.PerspectiveCamera) {
    this.character = character;
    this.planet = planet;
    this.camera = camera;
    this.particles = new FootstepParticles();

    // Start on North Pole (or slightly offset)
    this.unitPosition.set(0.001, 1, 0).normalize();
    this.localUp.copy(this.unitPosition).normalize();
    this.characterUp.copy(this.localUp);
    this.updatePositionVectors();

    // Determine initial tile normal
    const initialCell = this.planet.dggs.findCellAtPosition(this.unitPosition);
    if (initialCell?.tileNormal) {
      this.activeTileNormal.copy(initialCell.tileNormal);
      if (this.orientationMode === 'tile_normal') {
        this.characterUp.copy(initialCell.tileNormal);
      }
    }

    // Connect footstep callback
    this.character.onFootstep = (pos, _isLeft) => {
      this.particles.emit(pos, this.characterUp);
    };

    // Initialize camera
    const { targetCamPos, targetLookAt } = this.computeCameraTargets();
    this.currentCameraPos.copy(targetCamPos);
    this.currentLookAt.copy(targetLookAt);
    this.camera.position.copy(targetCamPos);
    this.camera.up.copy(this.characterUp);
    this.camera.lookAt(targetLookAt);
    this.currentCameraQuat.copy(this.camera.quaternion);

    // Initial character transform with valid right-handed basis
    this.character.group.position.copy(this.currentPosition);
    const fwd = this.forwardHeading.clone().sub(this.characterUp.clone().multiplyScalar(this.forwardHeading.dot(this.characterUp))).normalize();
    const charRight = new THREE.Vector3().crossVectors(this.characterUp, fwd).normalize();
    const rotMatrix = new THREE.Matrix4().makeBasis(charRight, this.characterUp, fwd);
    this.character.group.quaternion.setFromRotationMatrix(rotMatrix);
  }

  /**
   * Computes a stable, drift-free local tangent frame [up, north, east] at any point on the sphere.
   */
  public getTangentFrame(pos: THREE.Vector3): { up: THREE.Vector3; north: THREE.Vector3; east: THREE.Vector3 } {
    const up = pos.clone().normalize();
    let northRef = new THREE.Vector3(0, 1, 0);
    if (Math.abs(up.y) > 0.92) {
      northRef = new THREE.Vector3(0, 0, -1);
    }
    const east = new THREE.Vector3().crossVectors(up, northRef).normalize();
    const north = new THREE.Vector3().crossVectors(east, up).normalize();
    return { up, north, east };
  }

  public computeCameraTargets(): { targetCamPos: THREE.Vector3; targetLookAt: THREE.Vector3 } {
    const preset = CAMERA_PRESETS[this.cameraMode];

    if (this.cameraMode === 'orbital_planet') {
      const orbitDir = new THREE.Vector3()
        .copy(this.localUp)
        .addScaledVector(this.forwardHeading, 0.4)
        .normalize();
      const targetCamPos = orbitDir.multiplyScalar(this.planet.radius + preset.distance);
      const targetLookAt = new THREE.Vector3(0, 0, 0);
      return { targetCamPos, targetLookAt };
    } else if (this.cameraMode === 'icosahedral_net') {
      // Fixed view of the flat unfolded net — not character-relative at all,
      // since it's a separate static layout parked well away from the sphere.
      const netScale = this.planet.radius * NET_EDGE_CHORD;
      const targetLookAt = NET_WORLD_OFFSET.clone().add(
        new THREE.Vector3(NET_LAYOUT_CENTER.x * netScale, NET_LAYOUT_CENTER.y * netScale, 0),
      );
      const targetCamPos = targetLookAt.clone().add(new THREE.Vector3(0, 0, preset.distance));
      return { targetCamPos, targetLookAt };
    } else {
      // The camera naturally tracks behind the character's facing direction
      // with mouse-controlled orbit azimuth and pitch
      const backHeading = this.forwardHeading.clone().negate();
      const yawQuat = new THREE.Quaternion().setFromAxisAngle(this.characterUp, this.cameraAzimuth);
      const horizCamDir = backHeading.applyQuaternion(yawQuat).normalize();

      // camRight perpendicular to characterUp and horizCamDir
      const camRight = new THREE.Vector3().crossVectors(this.characterUp, horizCamDir).normalize();
      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(camRight, -this.cameraPitch);
      const finalCamOffsetDir = horizCamDir.applyQuaternion(pitchQuat).normalize();

      const dist = Math.max(1.8, preset.distance + this.cameraDistanceOffset);
      const targetCamPos = this.currentPosition
        .clone()
        .addScaledVector(this.characterUp, preset.height)
        .addScaledVector(finalCamOffsetDir, dist);

      const targetLookAt = this.currentPosition.clone().addScaledVector(this.characterUp, 1.0);
      return { targetCamPos, targetLookAt };
    }
  }

  public setCameraMode(mode: CameraMode) {
    this.cameraMode = mode;
    const preset = CAMERA_PRESETS[mode];
    this.camera.fov = preset.fov;
    this.camera.updateProjectionMatrix();
    this.cameraPitch = preset.pitch * (Math.PI / 180);
    this.cameraDistanceOffset = 0;
  }

  public setOrientationMode(mode: CharacterOrientationMode) {
    this.orientationMode = mode;
  }

  public handleWheel(deltaY: number) {
    this.cameraDistanceOffset = THREE.MathUtils.clamp(
      this.cameraDistanceOffset + deltaY * 0.005,
      -2.0,
      12.0
    );
  }

  private updatePositionVectors() {
    this.localUp.copy(this.unitPosition).normalize();
    const terrainR = this.planet.getTerrainHeight(this.unitPosition);
    this.currentPosition.copy(this.unitPosition).multiplyScalar(terrainR + this.verticalHeight);

    // Keep forwardHeading orthogonal to localUp
    this.forwardHeading.sub(this.localUp.clone().multiplyScalar(this.forwardHeading.dot(this.localUp)));
    if (this.forwardHeading.lengthSq() < 0.001) {
      const helper = Math.abs(this.localUp.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      this.forwardHeading.crossVectors(helper, this.localUp).normalize();
    } else {
      this.forwardHeading.normalize();
    }
  }

  public handlePointerMove(deltaX: number, deltaY: number) {
    const sensitivity = 0.0035;
    this.cameraAzimuth -= deltaX * sensitivity;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + deltaY * sensitivity, -0.25, 1.25);
  }

  public update(delta: number) {
    const dt = Math.min(delta, 0.06);

    // 1. Process A / D turning (yaw rotation around characterUp, not lateral strafe)
    const turnRate = 2.8; // radians per second (~160 deg/sec)
    if (this.input.turn !== 0) {
      // Turn left (-1) rotates counter-clockwise; Turn right (+1) rotates clockwise
      const turnAngle = -this.input.turn * turnRate * dt;
      const turnQuat = new THREE.Quaternion().setFromAxisAngle(this.characterUp, turnAngle);
      this.forwardHeading.applyQuaternion(turnQuat).normalize();
      this.angularTurnSpeed = -this.input.turn * turnRate;
    } else {
      this.angularTurnSpeed = 0;
    }

    // 2. Process W / S forward & reverse velocity (not lateral)
    let targetSpeed = 0;
    if (this.input.forward > 0) {
      targetSpeed = this.input.sprint ? this.sprintSpeed : this.walkSpeed;
    } else if (this.input.forward < 0) {
      targetSpeed = -(this.input.sprint ? this.sprintSpeed * 0.7 : this.walkSpeed * 0.65);
    }
    this.currentSpeed = THREE.MathUtils.damp(this.currentSpeed, targetSpeed, 12, dt);

    // 3. Great circle displacement along sphere
    if (Math.abs(this.currentSpeed) > 0.01) {
      const terrainR = this.planet.getTerrainHeight(this.unitPosition);
      const angularDistance = (this.currentSpeed * dt) / terrainR;

      // Rotation axis = normalize(unitPosition x forwardHeading)
      const rotAxis = new THREE.Vector3().crossVectors(this.unitPosition, this.forwardHeading).normalize();
      const stepQuat = new THREE.Quaternion().setFromAxisAngle(rotAxis, angularDistance);

      this.unitPosition.applyQuaternion(stepQuat).normalize();
      this.forwardHeading.applyQuaternion(stepQuat).normalize();
      this.updatePositionVectors();
    } else {
      this.updatePositionVectors();
    }

    // 4. Vertical Physics (Jump & Gravity)
    if (this.input.jump && this.isGrounded) {
      this.verticalVelocity = this.jumpForce;
      this.isGrounded = false;
      this.character.inAir = true;
    }

    if (!this.isGrounded) {
      this.verticalVelocity -= this.gravity * dt;
      this.verticalHeight += this.verticalVelocity * dt;

      if (this.verticalHeight <= 0) {
        this.verticalHeight = 0;
        this.verticalVelocity = 0;
        this.isGrounded = true;
        this.character.inAir = false;
        this.character.triggerLanding();
      }
    }

    // 5. Determine UP vector based on orientation mode:
    let desiredUp = this.localUp;
    if (this.orientationMode === 'tile_normal') {
      // Normal to whichever DGGS tile the character is interacting with
      const activeCell = this.planet.dggs.findCellAtPosition(this.unitPosition);
      if (activeCell?.tileNormal) {
        desiredUp = activeCell.tileNormal;
        this.activeTileNormal.copy(activeCell.tileNormal);
      }
    } else if (this.orientationMode === 'camera_top') {
      // Oriented to the camera view top (screen-up)
      const camViewTop = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
      desiredUp = camViewTop;
    }

    // Smoothly interpolate characterUp to eliminate any abrupt tile or camera snapping
    this.characterUp.lerp(desiredUp, Math.min(1.0, 14 * dt)).normalize();

    // 6. Update Character Mesh Position & Rotation Matrix
    this.character.group.position.copy(this.currentPosition);

    // Make forwardHeading strictly orthogonal to characterUp
    let fwd = this.forwardHeading.clone().sub(this.characterUp.clone().multiplyScalar(this.forwardHeading.dot(this.characterUp)));
    if (fwd.lengthSq() < 0.0001) {
      const helper = Math.abs(this.characterUp.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      fwd.crossVectors(helper, this.characterUp);
    }
    fwd.normalize();

    // In Three.js right-handed coordinates: [Local X = Right, Local Y = Up, Local Z = Forward]
    // Right = Up x Forward
    const charRight = new THREE.Vector3().crossVectors(this.characterUp, fwd).normalize();
    const rotMatrix = new THREE.Matrix4().makeBasis(charRight, this.characterUp, fwd);
    const targetCharQuat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

    this.character.group.quaternion.slerp(targetCharQuat, Math.min(1.0, 18 * dt));

    // Update procedural biped animation
    this.character.setAnimationState(this.currentSpeed, !this.isGrounded, this.angularTurnSpeed);
    this.character.update(dt);

    // Update particles
    this.particles.update(dt);

    // 7. Smooth Camera Rig
    this.updateCamera(dt);
  }

  private updateCamera(dt: number) {
    const { targetCamPos, targetLookAt } = this.computeCameraTargets();

    // Smooth damping for position and look-at
    const dampSpeed = this.cameraMode === 'orbital_planet' ? 4 : this.cameraMode === 'icosahedral_net' ? 8 : 14;
    this.currentCameraPos.x = THREE.MathUtils.damp(this.currentCameraPos.x, targetCamPos.x, dampSpeed, dt);
    this.currentCameraPos.y = THREE.MathUtils.damp(this.currentCameraPos.y, targetCamPos.y, dampSpeed, dt);
    this.currentCameraPos.z = THREE.MathUtils.damp(this.currentCameraPos.z, targetCamPos.z, dampSpeed, dt);

    this.currentLookAt.x = THREE.MathUtils.damp(this.currentLookAt.x, targetLookAt.x, dampSpeed, dt);
    this.currentLookAt.y = THREE.MathUtils.damp(this.currentLookAt.y, targetLookAt.y, dampSpeed, dt);
    this.currentLookAt.z = THREE.MathUtils.damp(this.currentLookAt.z, targetLookAt.z, dampSpeed, dt);

    this.camera.position.copy(this.currentCameraPos);
    this.camera.up.copy(this.cameraMode === 'icosahedral_net' ? new THREE.Vector3(0, 1, 0) : this.characterUp);
    this.camera.lookAt(this.currentLookAt);
    this.currentCameraQuat.copy(this.camera.quaternion);
  }

  public resetPosition() {
    this.unitPosition.set(0.001, 1, 0).normalize();
    this.localUp.copy(this.unitPosition).normalize();
    this.characterUp.copy(this.localUp);
    this.forwardHeading.set(0, 0, 1);
    this.cameraAzimuth = 0;
    this.cameraPitch = 20 * (Math.PI / 180);
    this.verticalHeight = 0;
    this.verticalVelocity = 0;
    this.updatePositionVectors();

    const { targetCamPos, targetLookAt } = this.computeCameraTargets();
    this.currentCameraPos.copy(targetCamPos);
    this.currentLookAt.copy(targetLookAt);
    this.camera.position.copy(targetCamPos);
    this.camera.up.copy(this.characterUp);
    this.camera.lookAt(targetLookAt);
    this.currentCameraQuat.copy(this.camera.quaternion);
  }
}
