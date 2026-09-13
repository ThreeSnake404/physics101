import { Box3, Quaternion, Vector3, type Object3D } from "three";
import type { RapierPhysicsApi } from "../rapierPhysics";
import { HINGE_LIMIT, LEG_PITCH_LIMIT } from "../modelParts";
import type { BalanceState, SteppingPhase } from "./types";

export type BalanceControllerOptions = {
  chassis: Object3D;
  physics: RapierPhysicsApi;
  partsByName?: Map<string, Object3D>;
  onStateChange?: (state: BalanceState) => void;
};

export class BalanceController {
  private chassis: Object3D;
  private physics: RapierPhysicsApi;
  private partsByName?: Map<string, Object3D>;
  private onStateChange?: (state: BalanceState) => void;

  private active = false;
  private chassisGrounded = false;
  private incrementalEffort = 0; // Accumulates larger/smaller adjustments
  private lastState: BalanceState | null = null;
  private chassisBox = new Box3();

  // Stepping gait state machine
  private steppingPhase: SteppingPhase = "idle";
  private phaseTimer = 0;
  private stepCount = 0;
  private manualStepRequested = false;
  private lastSteppedLeg: "left" | "right" = "right"; // so initial step starts with left leg

  // Track forward shoulder angles across steps to keep planted feet forward
  private leftShoulderForward = 0;
  private rightShoulderForward = 0;

  // Control gains for pitch stabilization & damping
  private kp = 2.8;        // Proportional gain for pitch angle
  private kd = 0.75;       // Derivative gain for damping pitch rate
  private ki = 1.4;        // Adaptive incremental adjustment rate
  private decayRate = 0.35; // Rate at which incremental adjustments scale down

  constructor(options: BalanceControllerOptions) {
    this.chassis = options.chassis;
    this.physics = options.physics;
    this.partsByName = options.partsByName;
    this.onStateChange = options.onStateChange;
  }

  public setGravityEnabled(enabled: boolean) {
    if (enabled) {
      if (!this.chassisGrounded) {
        this.active = true;
      }
    } else {
      this.active = false;
      this.incrementalEffort = 0;
    }
    this.emitState();
  }

  public triggerStepCycle() {
    if (this.chassisGrounded) return;
    this.active = true;
    this.manualStepRequested = true;
    if (
      this.steppingPhase === "idle" ||
      this.steppingPhase === "stabilize_left" ||
      this.steppingPhase === "stabilize_right"
    ) {
      if (this.lastSteppedLeg === "left") {
        this.steppingPhase = "shift_weight_left";
      } else {
        this.steppingPhase = "shift_weight_right";
      }
      this.phaseTimer = 0;
    }
    this.emitState();
  }

  public reset() {
    this.active = false;
    this.chassisGrounded = false;
    this.incrementalEffort = 0;
    this.steppingPhase = "idle";
    this.phaseTimer = 0;
    this.stepCount = 0;
    this.manualStepRequested = false;
    this.lastSteppedLeg = "right";
    this.leftShoulderForward = 0;
    this.rightShoulderForward = 0;
    this.emitState();
  }

  public isActive(): boolean {
    return this.active && !this.chassisGrounded;
  }

  public isGrounded(): boolean {
    return this.chassisGrounded;
  }

  public getSteppingPhase(): SteppingPhase {
    return this.steppingPhase;
  }

  /**
   * Called on every physics animation step to monitor the chassis orientation,
   * detect forward pitch, execute the weight-shifting and stepping state machine
   * (shift chassis in -X, lift left leg, swing shoulder forward, step down,
   * then shift in +X and step with right leg if needed), and run the pitch damping control loop.
   */
  public step(delta: number) {
    const chassisHandle = this.physics.getHandle(this.chassis);
    if (!chassisHandle) return;

    // 1. Check if the chassis makes contact with the ground
    if (this.checkChassisGroundContact(chassisHandle)) {
      this.chassisGrounded = true;
      this.steppingPhase = "grounded";
      this.active = false;
    }

    // 2. Monitor orientation and angular velocity of the chassis
    const bodyRot = chassisHandle.body.rotation();
    const q = new Quaternion(bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w);

    // World-space local UP vector (0, 1, 0) rotated by chassis orientation
    const upWorld = new Vector3(0, 1, 0).applyQuaternion(q);

    // Forward pitch angle around X axis (+Z is forward in front view)
    const pitchAngleRad = Math.atan2(upWorld.z, upWorld.y);

    // Angular velocity around world X axis (+ = rotating forward)
    const angvel = chassisHandle.body.angvel();
    const pitchRateRad = angvel.x;

    // Pitching forward is detected if angle is tilted forward (> 0.2 deg)
    // or if actively rotating forward (> 0.01 rad/s)
    const isPitchingForward = pitchAngleRad > 0.003 || pitchRateRad > 0.01;

    if (!this.active || this.chassisGrounded) {
      this.emitState(pitchAngleRad, pitchRateRad, isPitchingForward, 0);
      return;
    }

    // 3. Compute control effort with adaptive incremental adjustments
    if (isPitchingForward) {
      const errorRate = Math.max(0, pitchAngleRad) * 2.0 + Math.max(0, pitchRateRad) * 0.5;
      this.incrementalEffort = Math.min(
        1.0,
        this.incrementalEffort + this.ki * errorRate * delta,
      );
    } else {
      this.incrementalEffort = Math.max(0, this.incrementalEffort - this.decayRate * delta);
    }

    // Combined PD + incremental effort to dampen pitching action
    const pTerm = this.kp * Math.max(0, pitchAngleRad);
    const dTerm = this.kd * pitchRateRad;
    const rawEffort = pTerm + dTerm + this.incrementalEffort * 0.6;
    const effort = Math.max(0, Math.min(1.0, rawEffort));

    // Dynamic stiffness and damping
    const stanceStiffness = 16000;
    const stanceDamping = 700;
    const swingStiffness = 12000;
    const swingDamping = 400;

    // Step forward magnitude scaled with stabilizing effort
    const stepMagnitude = Math.min(HINGE_LIMIT * 0.85, 0.42 + effort * 0.20); // ~24° to ~35°

    this.phaseTimer += delta;

    const curTranslation = chassisHandle.body.translation();
    const curLinvel = chassisHandle.body.linvel();

    // Chassis height / fall rate for bounce bracing (must push before stepping unweights a leg)
    this.chassisBox.setFromObject(this.chassis);
    const chassisMinY = this.chassisBox.isEmpty() ? 99 : this.chassisBox.min.y;
    const fallRate = Math.max(0, -curLinvel.y);
    // Brace while falling, too low, or still bouncing (|vy| large) — don't unweight a leg yet
    const bracing = fallRate > 0.25 || chassisMinY < 1.8 || Math.abs(curLinvel.y) > 0.55;

    // 4. Stepping state machine — wait out bounce brace before unweighting a leg
    if (
      bracing &&
      (this.steppingPhase === "shift_weight_right" ||
        this.steppingPhase === "lift_left_leg" ||
        this.steppingPhase === "swing_left_forward" ||
        this.steppingPhase === "shift_weight_left" ||
        this.steppingPhase === "lift_right_leg" ||
        this.steppingPhase === "swing_right_forward")
    ) {
      // Abort single-leg phases on hard fall / second bounce — both hips must push
      this.steppingPhase = "idle";
      this.phaseTimer = 0;
    }

    if (this.steppingPhase === "idle") {
      const settledForStep =
        !bracing && chassisMinY > 1.9 && chassisMinY < 3.0 && Math.abs(curLinvel.y) < 0.3;
      if ((isPitchingForward || this.manualStepRequested) && settledForStep) {
        if (this.lastSteppedLeg === "left") {
          this.steppingPhase = "shift_weight_left";
        } else {
          this.steppingPhase = "shift_weight_right";
        }
        this.phaseTimer = 0;
        this.manualStepRequested = false;
      }
    }

    switch (this.steppingPhase) {
      case "shift_weight_right": {
        // During bounce brace, keep both legs loaded — do not unweight yet
        if (bracing) break;

        // Shift chassis in -X direction over the right stance leg
        const targetX = -0.85;
        const errorX = targetX - curTranslation.x;
        const shiftVx = Math.max(-0.65, Math.min(0.65, errorX * 2.5));
        chassisHandle.body.setLinvel({ x: shiftVx, y: curLinvel.y, z: curLinvel.z }, true);

        // Stance leg (Right) holds firm to support weight
        this.physics.driveJoint("UpperLegRight2", 0, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegRight2", 0, stanceStiffness, stanceDamping);
        this.physics.driveJoint("ShoulderRight2", this.rightShoulderForward, stanceStiffness, stanceDamping);

        // Swing leg (Left) softens to unweight
        this.physics.driveJoint("UpperLegLeft2", 0, 2500, 150);
        this.physics.driveJoint("LowerLegLeft2", 0, 2500, 150);
        this.physics.driveJoint("ShoulderLeft2", this.leftShoulderForward, stanceStiffness, stanceDamping);

        if (this.phaseTimer >= 0.35 || (this.phaseTimer >= 0.15 && curTranslation.x <= -0.70)) {
          this.steppingPhase = "lift_left_leg";
          this.phaseTimer = 0;
        }
        break;
      }

      case "lift_left_leg": {
        if (bracing) break;

        // Maintain support on stance leg over -X
        const targetX = -0.85;
        const errorX = targetX - curTranslation.x;
        const shiftVx = Math.max(-0.4, Math.min(0.4, errorX * 2.0));
        chassisHandle.body.setLinvel({ x: shiftVx, y: curLinvel.y, z: curLinvel.z }, true);

        this.physics.driveJoint("UpperLegRight2", 0, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegRight2", 0, stanceStiffness, stanceDamping);
        this.physics.driveJoint("ShoulderRight2", this.rightShoulderForward, stanceStiffness, stanceDamping);

        // Flex left hip and knee to lift foot off the ground (within ±30° leg pitch limit)
        this.physics.driveJoint("UpperLegLeft2", LEG_PITCH_LIMIT * 0.67, swingStiffness, swingDamping);
        this.physics.driveJoint("LowerLegLeft2", -LEG_PITCH_LIMIT, swingStiffness, swingDamping);
        this.physics.driveJoint("ShoulderLeft2", this.leftShoulderForward, swingStiffness, swingDamping);

        if (this.phaseTimer >= 0.30) {
          this.steppingPhase = "swing_left_forward";
          this.phaseTimer = 0;
        }
        break;
      }

      case "swing_left_forward": {
        // Stance leg continues supporting
        this.physics.driveJoint("UpperLegRight2", 0, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegRight2", 0, stanceStiffness, stanceDamping);
        this.physics.driveJoint("ShoulderRight2", this.rightShoulderForward, stanceStiffness, stanceDamping);

        // Keep left leg flexed/tucked
        this.physics.driveJoint("UpperLegLeft2", LEG_PITCH_LIMIT * 0.57, swingStiffness, swingDamping);
        this.physics.driveJoint("LowerLegLeft2", -LEG_PITCH_LIMIT * 0.95, swingStiffness, swingDamping);

        // Rotate left shoulder forward (+Y hinge axis)
        this.leftShoulderForward = stepMagnitude;
        this.physics.driveJoint("ShoulderLeft2", this.leftShoulderForward, swingStiffness, swingDamping);

        if (this.phaseTimer >= 0.35) {
          this.steppingPhase = "step_down_left";
          this.phaseTimer = 0;
        }
        break;
      }

      case "step_down_left": {
        // Keep left shoulder forward while extending leg down
        this.physics.driveJoint("ShoulderLeft2", this.leftShoulderForward, stanceStiffness, stanceDamping);
        this.physics.driveJoint("ShoulderRight2", this.rightShoulderForward, stanceStiffness, stanceDamping);

        // Extend left leg down to plant on the ground
        this.physics.driveJoint("UpperLegLeft2", 0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegLeft2", -0.04, stanceStiffness, stanceDamping);

        // Right leg stance
        this.physics.driveJoint("UpperLegRight2", 0, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegRight2", 0, stanceStiffness, stanceDamping);

        const footNearGround = this.isFootNearGround("FootLeft2");
        if ((this.phaseTimer >= 0.20 && footNearGround) || this.phaseTimer >= 0.40) {
          this.stepCount++;
          this.steppingPhase = "stabilize_left";
          this.phaseTimer = 0;
        }
        break;
      }

      case "stabilize_left": {
        // Both feet planted! Both legs support chassis
        this.physics.driveJoint("ShoulderLeft2", this.leftShoulderForward, stanceStiffness, stanceDamping);
        this.physics.driveJoint("ShoulderRight2", this.rightShoulderForward, stanceStiffness, stanceDamping);
        this.physics.driveJoint("UpperLegLeft2", 0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegLeft2", -0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("UpperLegRight2", 0, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegRight2", 0, stanceStiffness, stanceDamping);

        // Center chassis lateral sway
        const shiftVx = Math.max(-0.4, Math.min(0.4, (0 - curTranslation.x) * 2.0));
        chassisHandle.body.setLinvel({ x: shiftVx, y: curLinvel.y, z: curLinvel.z }, true);

        // Check if chassis is still pitching forward after stabilization period
        if (this.phaseTimer >= 0.40) {
          this.lastSteppedLeg = "left";
          if (isPitchingForward && !this.chassisGrounded) {
            // Need next step with the right leg!
            this.steppingPhase = "shift_weight_left";
            this.phaseTimer = 0;
          } else {
            // Stabilized
            this.steppingPhase = "idle";
          }
        }
        break;
      }

      case "shift_weight_left": {
        if (bracing) break;

        // Shift chassis in +X direction over the left stance leg
        const targetX = 0.85;
        const errorX = targetX - curTranslation.x;
        const shiftVx = Math.max(-0.65, Math.min(0.65, errorX * 2.5));
        chassisHandle.body.setLinvel({ x: shiftVx, y: curLinvel.y, z: curLinvel.z }, true);

        // Stance leg (Left) holds firm
        this.physics.driveJoint("UpperLegLeft2", 0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegLeft2", -0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("ShoulderLeft2", this.leftShoulderForward, stanceStiffness, stanceDamping);

        // Swing leg (Right) softens to unweight
        this.physics.driveJoint("UpperLegRight2", 0, 2500, 150);
        this.physics.driveJoint("LowerLegRight2", 0, 2500, 150);
        this.physics.driveJoint("ShoulderRight2", this.rightShoulderForward, stanceStiffness, stanceDamping);

        if (this.phaseTimer >= 0.35 || (this.phaseTimer >= 0.15 && curTranslation.x >= 0.70)) {
          this.steppingPhase = "lift_right_leg";
          this.phaseTimer = 0;
        }
        break;
      }

      case "lift_right_leg": {
        if (bracing) break;

        // Maintain support on stance leg over +X
        const targetX = 0.85;
        const errorX = targetX - curTranslation.x;
        const shiftVx = Math.max(-0.4, Math.min(0.4, errorX * 2.0));
        chassisHandle.body.setLinvel({ x: shiftVx, y: curLinvel.y, z: curLinvel.z }, true);

        this.physics.driveJoint("UpperLegLeft2", 0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegLeft2", -0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("ShoulderLeft2", this.leftShoulderForward, stanceStiffness, stanceDamping);

        // Flex right hip and knee to lift foot off the ground (within ±30° leg pitch limit)
        this.physics.driveJoint("UpperLegRight2", -LEG_PITCH_LIMIT * 0.67, swingStiffness, swingDamping);
        this.physics.driveJoint("LowerLegRight2", LEG_PITCH_LIMIT, swingStiffness, swingDamping);
        this.physics.driveJoint("ShoulderRight2", this.rightShoulderForward, swingStiffness, swingDamping);

        if (this.phaseTimer >= 0.30) {
          this.steppingPhase = "swing_right_forward";
          this.phaseTimer = 0;
        }
        break;
      }

      case "swing_right_forward": {
        // Left stance leg continues supporting
        this.physics.driveJoint("UpperLegLeft2", 0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegLeft2", -0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("ShoulderLeft2", this.leftShoulderForward, stanceStiffness, stanceDamping);

        // Keep right leg flexed/tucked
        this.physics.driveJoint("UpperLegRight2", -LEG_PITCH_LIMIT * 0.57, swingStiffness, swingDamping);
        this.physics.driveJoint("LowerLegRight2", LEG_PITCH_LIMIT * 0.95, swingStiffness, swingDamping);

        // Rotate right shoulder forward (negative angle for right shoulder)
        this.rightShoulderForward = -stepMagnitude;
        this.physics.driveJoint("ShoulderRight2", this.rightShoulderForward, swingStiffness, swingDamping);

        if (this.phaseTimer >= 0.35) {
          this.steppingPhase = "step_down_right";
          this.phaseTimer = 0;
        }
        break;
      }

      case "step_down_right": {
        // Keep right shoulder forward while extending leg down
        this.physics.driveJoint("ShoulderRight2", this.rightShoulderForward, stanceStiffness, stanceDamping);
        this.physics.driveJoint("ShoulderLeft2", this.leftShoulderForward, stanceStiffness, stanceDamping);

        // Extend right leg down to plant on the ground
        this.physics.driveJoint("UpperLegRight2", -0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegRight2", 0.04, stanceStiffness, stanceDamping);

        // Left leg stance
        this.physics.driveJoint("UpperLegLeft2", 0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegLeft2", -0.04, stanceStiffness, stanceDamping);

        const footNearGround = this.isFootNearGround("FootRight2");
        if ((this.phaseTimer >= 0.20 && footNearGround) || this.phaseTimer >= 0.40) {
          this.stepCount++;
          this.steppingPhase = "stabilize_right";
          this.phaseTimer = 0;
        }
        break;
      }

      case "stabilize_right": {
        // Both feet planted!
        this.physics.driveJoint("ShoulderLeft2", this.leftShoulderForward, stanceStiffness, stanceDamping);
        this.physics.driveJoint("ShoulderRight2", this.rightShoulderForward, stanceStiffness, stanceDamping);
        this.physics.driveJoint("UpperLegLeft2", 0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegLeft2", -0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("UpperLegRight2", -0.04, stanceStiffness, stanceDamping);
        this.physics.driveJoint("LowerLegRight2", 0.04, stanceStiffness, stanceDamping);

        // Center chassis lateral sway
        const shiftVx = Math.max(-0.4, Math.min(0.4, (0 - curTranslation.x) * 2.0));
        chassisHandle.body.setLinvel({ x: shiftVx, y: curLinvel.y, z: curLinvel.z }, true);

        // Repeat process if still pitching forward until chassis touches ground
        if (this.phaseTimer >= 0.40) {
          this.lastSteppedLeg = "right";
          if (isPitchingForward && !this.chassisGrounded) {
            this.steppingPhase = "shift_weight_right";
            this.phaseTimer = 0;
          } else {
            this.steppingPhase = "idle";
          }
        }
        break;
      }

      case "grounded":
      default:
        break;
    }

    // 5. Continuous upper-leg push-back (stance legs only).
    // On v0-5, inward hip rotation (Left − / Right +) raises the chassis when feet are planted.
    // Drive hard toward the full ±30° limit so the second bounce doesn't collapse.
    const leftInSwing =
      this.steppingPhase === "lift_left_leg" ||
      this.steppingPhase === "swing_left_forward";
    const rightInSwing =
      this.steppingPhase === "lift_right_leg" ||
      this.steppingPhase === "swing_right_forward";

    const needsPush =
      bracing || isPitchingForward || effort > 0.02 || this.steppingPhase !== "idle";

    if (needsPush) {
      const ascending = curLinvel.y > 0.2;
      const pushFrac = Math.min(1, Math.max(effort, fallRate * 0.5, bracing && !ascending ? 1 : 0));
      // Ascending after a bounce: ease off so we don't rocket the chassis.
      // Descending / second bounce: drive the full ±30° inward limit to push back hard.
      const upperPush = ascending
        ? LEG_PITCH_LIMIT * (0.55 + 0.2 * effort) // ~16.5°–22.5° while rising
        : LEG_PITCH_LIMIT * (0.95 + 0.05 * pushFrac); // ~28.5° → 30° while falling
      const pushStiffness = ascending ? 14000 : 22000 + pushFrac * 8000;
      const pushDamping = ascending ? 900 : 750 + pushFrac * 400;

      if (!leftInSwing || bracing) {
        this.physics.driveJoint("UpperLegLeft2", -upperPush, pushStiffness, pushDamping);
        if (bracing) {
          this.physics.driveJoint("LowerLegLeft2", 0, pushStiffness, pushDamping);
        }
      }
      if (!rightInSwing || bracing) {
        this.physics.driveJoint("UpperLegRight2", upperPush, pushStiffness, pushDamping);
        if (bracing) {
          this.physics.driveJoint("LowerLegRight2", 0, pushStiffness, pushDamping);
        }
      }
    }

    // 6. Dynamic reactive torque on pitch hinges (+Z) to continually damp forward pitch / drop
    const reactiveTorque =
      (pitchRateRad * 40.0 + pitchAngleRad * 55.0 + fallRate * 12.0) * (1 + effort * 2.5);
    if (Math.abs(reactiveTorque) > 0.1) {
      this.physics.applyJointTorque("UpperLegLeft2", -reactiveTorque * 0.85);
      this.physics.applyJointTorque("UpperLegRight2", reactiveTorque * 0.85);
    }

    this.emitState(pitchAngleRad, pitchRateRad, isPitchingForward, effort);
  }

  /**
   * Helper to detect if a foot is close to or contacting the ground plane (Y <= 0).
   */
  private isFootNearGround(name: string): boolean {
    const foot = this.partsByName?.get(name);
    if (!foot) return false;
    const handle = this.physics.getHandle(foot);
    if (!handle) return false;
    const translationY = handle.body.translation().y;
    return translationY <= 0.85;
  }

  /**
   * Detects if any part of the chassis makes physical contact with the ground plane.
   * Uses the chassis mesh AABB only — body translation origin varies by model and is
   * not a reliable proxy for ground contact (e.g. v0-5 rest origin is ~1.4 m).
   */
  private checkChassisGroundContact(_chassisHandle: { body: any }): boolean {
    this.chassisBox.setFromObject(this.chassis);
    if (this.chassisBox.isEmpty()) return false;

    // Ground plane is at Y = 0; small epsilon for collider thickness / numeric contact.
    return this.chassisBox.min.y <= 0.08;
  }

  private emitState(
    pitchAngleRad = 0,
    pitchRateRad = 0,
    isPitchingForward = false,
    effort = 0,
  ) {
    const pitchDeg = Math.round((pitchAngleRad * 180) / Math.PI * 10) / 10;
    const pitchRateDeg = Math.round((pitchRateRad * 180) / Math.PI * 10) / 10;
    const adjustmentMagnitude = Math.round(effort * 1000) / 1000;

    let status: BalanceState["status"] = "idle";
    if (this.chassisGrounded) {
      status = "grounded";
    } else if (this.active) {
      status = Math.abs(pitchDeg) < 1.0 && Math.abs(pitchRateDeg) < 5 ? "stabilized" : "stabilizing";
    }

    const state: BalanceState = {
      active: this.active && !this.chassisGrounded,
      pitchDeg,
      pitchRateDeg,
      isPitchingForward,
      adjustmentMagnitude,
      chassisGrounded: this.chassisGrounded,
      status,
      steppingPhase: this.steppingPhase,
      stepCount: this.stepCount,
    };

    if (
      this.lastState &&
      this.lastState.active === state.active &&
      this.lastState.status === state.status &&
      this.lastState.pitchDeg === state.pitchDeg &&
      this.lastState.pitchRateDeg === state.pitchRateDeg &&
      this.lastState.adjustmentMagnitude === state.adjustmentMagnitude &&
      this.lastState.chassisGrounded === state.chassisGrounded &&
      this.lastState.steppingPhase === state.steppingPhase &&
      this.lastState.stepCount === state.stepCount
    ) {
      return;
    }

    this.lastState = state;
    this.onStateChange?.(state);
  }
}
