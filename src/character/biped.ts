import * as THREE from 'three';

export interface LegAssembly {
  hipPivot: THREE.Group;
  thigh: THREE.Mesh;
  kneePivot: THREE.Group;
  shin: THREE.Mesh;
  anklePivot: THREE.Group;
  foot: THREE.Mesh;
  planted: boolean;
}

export class BipedCharacter {
  public group: THREE.Group;
  public bodyGroup: THREE.Group;
  public bodySphere: THREE.Mesh;
  public visor: THREE.Mesh;
  public visorGlow: THREE.Mesh;
  public antenna: THREE.Group;

  public leftLeg: LegAssembly;
  public rightLeg: LegAssembly;

  // Animation parameters
  private walkPhase = 0;
  private isMoving = false;
  private currentSpeed = 0;
  public inAir = false;
  private landingSquash = 0;
  private turnLean = 0;

  // Callback for footstep sound / particle
  public onFootstep?: (pos: THREE.Vector3, isLeft: boolean) => void;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'RedBipedCharacter';
    this.group.frustumCulled = false;

    // 1. Body Group (allows independent bobbing, squash, and lean)
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.position.y = 0.95; // Base height above ground
    this.bodyGroup.frustumCulled = false;
    this.group.add(this.bodyGroup);

    // Main Red Sphere Body
    const bodyGeom = new THREE.SphereGeometry(0.55, 32, 32);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xef4444, // Vibrant Red
      roughness: 0.28,
      metalness: 0.2,
      emissive: 0x7f1d1d,
      emissiveIntensity: 0.12,
    });
    this.bodySphere = new THREE.Mesh(bodyGeom, bodyMat);
    this.bodySphere.frustumCulled = false;
    this.bodyGroup.add(this.bodySphere);

    // Front Visor (gives clear orientation & cute robot explorer charm)
    const visorGeom = new THREE.CylinderGeometry(0.38, 0.42, 0.22, 24, 1, false, -Math.PI / 3, (2 * Math.PI) / 3);
    visorGeom.rotateZ(Math.PI / 2);
    visorGeom.rotateY(Math.PI / 2);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.15,
      metalness: 0.85,
    });
    this.visor = new THREE.Mesh(visorGeom, visorMat);
    this.visor.position.set(0, 0.06, 0.28);
    this.bodyGroup.add(this.visor);

    // Visor glowing eye slit
    const glowGeom = new THREE.BoxGeometry(0.36, 0.05, 0.05);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8, // Electric blue scanner
    });
    this.visorGlow = new THREE.Mesh(glowGeom, glowMat);
    this.visorGlow.position.set(0, 0.06, 0.52);
    this.bodyGroup.add(this.visorGlow);

    // Antenna on top
    this.antenna = new THREE.Group();
    const stemGeom = new THREE.CylinderGeometry(0.02, 0.03, 0.24, 8);
    stemGeom.translate(0, 0.12, 0);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9, roughness: 0.2 });
    const stem = new THREE.Mesh(stemGeom, stemMat);
    this.antenna.add(stem);

    const tipGeom = new THREE.SphereGeometry(0.07, 12, 12);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const tip = new THREE.Mesh(tipGeom, tipMat);
    tip.position.y = 0.24;
    this.antenna.add(tip);
    this.antenna.position.set(0, 0.52, -0.08);
    this.antenna.rotation.x = -0.15;
    this.bodyGroup.add(this.antenna);

    // Backpack / Thruster pack
    const packGeom = new THREE.BoxGeometry(0.35, 0.42, 0.22);
    const packMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.6 });
    const pack = new THREE.Mesh(packGeom, packMat);
    pack.position.set(0, 0.05, -0.48);
    this.bodyGroup.add(pack);

    // Small thruster bells at bottom of pack
    for (const tx of [-0.1, 0.1]) {
      const bellGeom = new THREE.ConeGeometry(0.06, 0.12, 8);
      const bellMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.9, roughness: 0.2 });
      const bell = new THREE.Mesh(bellGeom, bellMat);
      bell.position.set(tx, -0.22, -0.48);
      bell.rotation.x = Math.PI;
      this.bodyGroup.add(bell);
    }

    // 2. Build the Two Articulated Legs
    this.leftLeg = this.createLegAssembly(-0.25);
    this.rightLeg = this.createLegAssembly(0.25);
    this.group.add(this.leftLeg.hipPivot);
    this.group.add(this.rightLeg.hipPivot);
  }

  private createLegAssembly(sideX: number): LegAssembly {
    // Hip Pivot (located beneath body)
    const hipPivot = new THREE.Group();
    hipPivot.position.set(sideX, 0.72, 0);

    // Upper Leg (Thigh)
    const thighLength = 0.38;
    const thighGeom = new THREE.CylinderGeometry(0.065, 0.055, thighLength, 12);
    thighGeom.translate(0, -thighLength / 2, 0);
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.7,
      roughness: 0.35,
    });
    const thigh = new THREE.Mesh(thighGeom, legMat);
    thigh.castShadow = true;
    hipPivot.add(thigh);

    // Knee Pivot
    const kneePivot = new THREE.Group();
    kneePivot.position.set(0, -thighLength, 0);
    hipPivot.add(kneePivot);

    const kneeJointGeom = new THREE.SphereGeometry(0.075, 12, 12);
    const kneeJointMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.2 });
    const kneeJoint = new THREE.Mesh(kneeJointGeom, kneeJointMat);
    kneePivot.add(kneeJoint);

    // Lower Leg (Shin)
    const shinLength = 0.38;
    const shinGeom = new THREE.CylinderGeometry(0.055, 0.05, shinLength, 12);
    shinGeom.translate(0, -shinLength / 2, 0);
    const shin = new THREE.Mesh(shinGeom, legMat);
    shin.castShadow = true;
    kneePivot.add(shin);

    // Ankle Pivot & Foot
    const anklePivot = new THREE.Group();
    anklePivot.position.set(0, -shinLength, 0);
    kneePivot.add(anklePivot);

    // Foot (rounded boot pad)
    const footGeom = new THREE.BoxGeometry(0.14, 0.09, 0.28);
    footGeom.translate(0, -0.045, 0.06);
    const footMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.5,
      roughness: 0.6,
    });
    const foot = new THREE.Mesh(footGeom, footMat);
    foot.castShadow = true;
    anklePivot.add(foot);

    return {
      hipPivot,
      thigh,
      kneePivot,
      shin,
      anklePivot,
      foot,
      planted: true,
    };
  }

  public setAnimationState(speed: number, inAir: boolean, turnRate: number) {
    this.currentSpeed = speed;
    this.isMoving = speed > 0.08;
    this.inAir = inAir;
    this.turnLean = THREE.MathUtils.clamp(THREE.MathUtils.lerp(this.turnLean, -turnRate * 0.15, 0.12), -0.15, 0.15);
  }

  public triggerLanding() {
    this.landingSquash = 1.0;
  }

  public update(delta: number) {
    // 1. Landing squash recovery
    if (this.landingSquash > 0.01) {
      this.landingSquash = THREE.MathUtils.damp(this.landingSquash, 0, 14, delta);
    } else {
      this.landingSquash = 0;
    }

    const squashScaleY = 1.0 - this.landingSquash * 0.28;
    const squashScaleXZ = 1.0 + this.landingSquash * 0.18;
    this.bodySphere.scale.set(squashScaleXZ, squashScaleY, squashScaleXZ);

    // 2. Walk cycle progression
    if (this.isMoving && !this.inAir) {
      const stepFreq = 8.5 * Math.min(1.8, Math.max(0.7, Math.abs(this.currentSpeed) / 4.0));
      if (this.currentSpeed < -0.05) {
        this.walkPhase -= delta * stepFreq;
      } else {
        this.walkPhase += delta * stepFreq;
      }
    } else if (Math.abs(this.turnLean) > 0.03 && !this.inAir) {
      // Subtle leg shuffle when turning in place
      this.walkPhase += delta * 6.5;
    } else {
      // Smoothly return walk phase towards neutral
      this.walkPhase = THREE.MathUtils.damp(this.walkPhase, Math.round(this.walkPhase / (2 * Math.PI)) * 2 * Math.PI, 6, delta);
    }

    // 3. In-air pose
    if (this.inAir) {
      // Tucked jump legs
      this.leftLeg.hipPivot.rotation.x = THREE.MathUtils.damp(this.leftLeg.hipPivot.rotation.x, -0.45, 10, delta);
      this.leftLeg.kneePivot.rotation.x = THREE.MathUtils.damp(this.leftLeg.kneePivot.rotation.x, 0.7, 10, delta);
      this.leftLeg.anklePivot.rotation.x = THREE.MathUtils.damp(this.leftLeg.anklePivot.rotation.x, 0.2, 10, delta);

      this.rightLeg.hipPivot.rotation.x = THREE.MathUtils.damp(this.rightLeg.hipPivot.rotation.x, -0.45, 10, delta);
      this.rightLeg.kneePivot.rotation.x = THREE.MathUtils.damp(this.rightLeg.kneePivot.rotation.x, 0.7, 10, delta);
      this.rightLeg.anklePivot.rotation.x = THREE.MathUtils.damp(this.rightLeg.anklePivot.rotation.x, 0.2, 10, delta);

      this.bodyGroup.position.y = 0.95;
      this.bodyGroup.rotation.z = this.turnLean;
      return;
    }

    // 4. Ground locomotion
    const pL = this.walkPhase;
    const pR = this.walkPhase + Math.PI;

    const strideAmp = Math.min(0.75, Math.abs(this.currentSpeed) * 0.12 + (Math.abs(this.turnLean) > 0.03 ? 0.22 : 0));

    // Left Leg swing & knee flexion
    const sinL = Math.sin(pL);
    const cosL = Math.cos(pL);
    const hipAngleL = sinL * strideAmp;
    const kneeAngleL = Math.max(0, cosL) * strideAmp * 1.5;
    const ankleAngleL = -hipAngleL * 0.45;

    this.leftLeg.hipPivot.rotation.x = hipAngleL;
    this.leftLeg.kneePivot.rotation.x = kneeAngleL;
    this.leftLeg.anklePivot.rotation.x = ankleAngleL;

    // Right Leg swing & knee flexion
    const sinR = Math.sin(pR);
    const cosR = Math.cos(pR);
    const hipAngleR = sinR * strideAmp;
    const kneeAngleR = Math.max(0, cosR) * strideAmp * 1.5;
    const ankleAngleR = -hipAngleR * 0.45;

    this.rightLeg.hipPivot.rotation.x = hipAngleR;
    this.rightLeg.kneePivot.rotation.x = kneeAngleR;
    this.rightLeg.anklePivot.rotation.x = ankleAngleR;

    // Detect foot plant events for sound / dust
    if (this.onFootstep && this.isMoving) {
      if (sinL > 0.85 && !this.leftLeg.planted) {
        this.leftLeg.planted = true;
        const worldPos = new THREE.Vector3();
        this.leftLeg.foot.getWorldPosition(worldPos);
        this.onFootstep(worldPos, true);
      } else if (sinL < 0.2) {
        this.leftLeg.planted = false;
      }

      if (sinR > 0.85 && !this.rightLeg.planted) {
        this.rightLeg.planted = true;
        const worldPos = new THREE.Vector3();
        this.rightLeg.foot.getWorldPosition(worldPos);
        this.onFootstep(worldPos, false);
      } else if (sinR < 0.2) {
        this.rightLeg.planted = false;
      }
    }

    // Body rhythmic bobbing & sway
    const bob = Math.abs(Math.sin(this.walkPhase)) * (this.isMoving ? 0.08 : 0.015);
    const sway = Math.sin(this.walkPhase) * (this.isMoving ? 0.04 : 0);
    this.bodyGroup.position.y = 0.95 - bob;
    this.bodyGroup.position.x = sway;
    this.bodyGroup.rotation.z = this.turnLean + sway * 0.5;
    this.bodyGroup.rotation.x = this.isMoving ? 0.12 : 0; // Slight forward lean when running

    // Idle breathing
    if (!this.isMoving) {
      const breath = Math.sin(Date.now() * 0.003) * 0.02;
      this.bodyGroup.position.y += breath;
      this.bodySphere.scale.set(1 + breath * 0.5, 1 - breath * 0.5, 1 + breath * 0.5);
    }
  }
}
