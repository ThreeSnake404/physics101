import {
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Mesh,
  type Object3D,
} from "three";
import RAPIER from "@dimforge/rapier3d-compat";

/**
 * Rapier helper modeled on three/addons/physics/RapierPhysics.js.
 *
 * Differences from the official helper:
 * - BufferGeometry uses a convex hull so meshes can be dynamic.
 *   Official trimesh colliders are not valid on dynamic rigid bodies.
 * - Collider vertices are transformed into body space, including scale.
 * - A Group can share one rigid body across several visual meshes.
 * - The caller steps the world from the render loop.
 */

const _vertex = new Vector3();
const _scale = new Vector3(1, 1, 1);
const _quat = new Quaternion();
const _matrix = new Matrix4();
const _invBody = new Matrix4();
const _toBody = new Matrix4();

export type PhysicsHandle = {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider | RAPIER.Collider[];
  visualOffset: Quaternion;
  physicsRotation: Quaternion;
};

/** Same material for every part: mass scales with collider volume. */
export const MATERIAL_DENSITY = 3;

const SEEK_STIFFNESS = 340;
const SEEK_DAMPING = 52;
const LOCK_STIFFNESS = 2000;
const LOCK_DAMPING = 120;
const ARRIVE_EPS = (3 * Math.PI) / 180;

export type HingeBinding = {
  name: string;
  joint: RAPIER.RevoluteImpulseJoint;
  parent: RAPIER.RigidBody;
  child: RAPIER.RigidBody;
  limits: { min: number; max: number };
  axisLocal: Vector3;
};

type MotorState = {
  binding: HingeBinding;
  targetAngle: number;
  pendingTarget: number | null;
  locked: boolean;
  currentAngle: number;
};

export type JointMotorState = {
  angle: number;
  target: number;
  locked: boolean;
  min: number;
  max: number;
};

const GROUP_GROUND = 0x0001;
const GROUP_PART = 0x0002;

function interactionGroups(membership: number, filter: number) {
  return (membership << 16) | filter;
}

const GROUND_GROUPS = interactionGroups(GROUP_GROUND, GROUP_PART);
const PART_GROUPS = interactionGroups(GROUP_PART, GROUP_GROUND);

function collectPositionAttribute(geometry: BufferGeometry): Vector3[] {
  const position = geometry.getAttribute("position");
  const vertices: Vector3[] = [];

  for (let i = 0; i < position.count; i++) {
    vertices.push(_vertex.fromBufferAttribute(position, i).clone());
  }

  return vertices;
}

function transformedVertices(mesh: Mesh, bodyMatrix: Matrix4): Float32Array {
  mesh.updateWorldMatrix(true, false);
  _invBody.copy(bodyMatrix).invert();
  _toBody.multiplyMatrices(_invBody, mesh.matrixWorld);

  const local = collectPositionAttribute(mesh.geometry);
  const out = new Float32Array(local.length * 3);

  for (let i = 0; i < local.length; i++) {
    local[i].applyMatrix4(_toBody);
    out[i * 3] = local[i].x;
    out[i * 3 + 1] = local[i].y;
    out[i * 3 + 2] = local[i].z;
  }

  return out;
}

function cuboidFromGeometry(geometry: BufferGeometry): RAPIER.ColliderDesc | null {
  if (geometry.type !== "BoxGeometry") return null;

  const parameters = (geometry as BufferGeometry & {
    parameters?: { width?: number; height?: number; depth?: number };
  }).parameters;
  if (!parameters) return null;

  const sx = parameters.width !== undefined ? parameters.width / 2 : 0.5;
  const sy = parameters.height !== undefined ? parameters.height / 2 : 0.5;
  const sz = parameters.depth !== undefined ? parameters.depth / 2 : 0.5;
  return RAPIER.ColliderDesc.cuboid(sx, sy, sz);
}

function colliderFromMesh(mesh: Mesh, bodyMatrix: Matrix4): RAPIER.ColliderDesc | null {
  const cuboid = cuboidFromGeometry(mesh.geometry);
  if (cuboid) return cuboid;

  const points = transformedVertices(mesh, bodyMatrix);
  const hull = RAPIER.ColliderDesc.convexHull(points);
  if (hull) return hull;

  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return null;

  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  mesh.updateWorldMatrix(true, false);
  _invBody.copy(bodyMatrix).invert();
  _toBody.multiplyMatrices(_invBody, mesh.matrixWorld);
  center.applyMatrix4(_toBody);
  size.applyMatrix4(_toBody.clone().setPosition(0, 0, 0));

  return RAPIER.ColliderDesc.cuboid(
    Math.abs(size.x) / 2 || 0.05,
    Math.abs(size.y) / 2 || 0.05,
    Math.abs(size.z) / 2 || 0.05,
  ).setTranslation(center.x, center.y, center.z);
}

export async function RapierPhysics() {
  await RAPIER.init();

  const gravityOn = { x: 0, y: -9.81, z: 0 };
  const gravityOff = { x: 0, y: 0, z: 0 };
  const world = new RAPIER.World(gravityOff);
  world.timestep = 1 / 60;
  let gravityEnabled = false;
  let pendingGravity: boolean | null = null;
  const dynamics: Object3D[] = [];
  const meshMap = new WeakMap<Object3D, PhysicsHandle>();

  function copyRotation(body: RAPIER.RigidBody) {
    const rotation = body.rotation();
    return new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  function createBody(position: Vector3, quaternion: Quaternion, dynamic: boolean) {
    const desc = dynamic ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed();
    desc.setTranslation(position.x, position.y, position.z);
    desc.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
    if (dynamic) {
      desc.setCcdEnabled(true);
      desc.setLinearDamping(0.4);
      desc.setAngularDamping(2.4);
    }
    return world.createRigidBody(desc);
  }

  function configureCollider(shape: RAPIER.ColliderDesc, dynamic: boolean, restitution: number) {
    if (dynamic) {
      shape.setDensity(MATERIAL_DENSITY);
      shape.setCollisionGroups(PART_GROUPS);
    }
    shape.setRestitution(restitution);
    shape.setFriction(0.8);
    return shape;
  }

  function addMesh(mesh: Mesh, dynamic = true, restitution = 0) {
    addObject(mesh, [mesh], dynamic, restitution);
  }

  function addObject(
    object: Object3D,
    meshes: Mesh[],
    dynamic = true,
    restitution = 0,
    physicsRotation?: Quaternion,
  ) {
    object.updateWorldMatrix(true, true);
    const position = new Vector3();
    const visualRotation = new Quaternion();
    object.matrixWorld.decompose(position, visualRotation, new Vector3());

    const bodyRotation = physicsRotation?.clone() ?? visualRotation.clone();
    const visualOffset = bodyRotation.clone().invert().multiply(visualRotation);
    const bodyMatrix = new Matrix4().compose(position, bodyRotation, _scale);
    const body = createBody(position, bodyRotation, dynamic);
    const colliders: RAPIER.Collider[] = [];

    for (const mesh of meshes) {
      const shape = colliderFromMesh(mesh, bodyMatrix);
      if (!shape) {
        console.error("RapierPhysics: unsupported geometry", mesh.geometry.type);
        continue;
      }
      configureCollider(shape, dynamic, restitution);
      colliders.push(world.createCollider(shape, body));
    }

    if (colliders.length === 0) {
      world.removeRigidBody(body);
      return;
    }

    if (!object.userData.physics) object.userData.physics = {};
    const handle: PhysicsHandle = {
      body,
      collider: colliders.length === 1 ? colliders[0] : colliders,
      visualOffset,
      physicsRotation: bodyRotation.clone(),
    };
    object.userData.physics.body = handle.body;
    object.userData.physics.collider = handle.collider;
    object.userData.physics.visualOffset = visualOffset;

    if (dynamic) {
      dynamics.push(object);
      meshMap.set(object, handle);
    }
  }

  function getHandle(object: Object3D) {
    return meshMap.get(object) ?? null;
  }

  /**
   * True hinge. Rapier copies `axisLocal` onto both bodies, so the child
   * physics frame must already share that axis (see `physicsRotation` on
   * addObject). The exported mesh orientation stays in `visualOffset`.
   */
  function addRevoluteJoint(
    name: string,
    parent: Object3D,
    child: Object3D,
    worldPivot: Vector3,
    axisLocal: Vector3,
    limits: { min: number; max: number },
  ): HingeBinding | null {
    const parentHandle = meshMap.get(parent);
    const childHandle = meshMap.get(child);
    if (!parentHandle || !childHandle) return null;

    const parentPos = new Vector3().copy(parentHandle.body.translation());
    const parentRot = copyRotation(parentHandle.body);
    const childPos = new Vector3().copy(childHandle.body.translation());
    const childRot = copyRotation(childHandle.body);

    const parentInvMat = new Matrix4().compose(parentPos, parentRot, _scale).invert();
    const childInvMat = new Matrix4().compose(childPos, childRot, _scale).invert();
    const anchor1 = worldPivot.clone().applyMatrix4(parentInvMat);
    const anchor2 = worldPivot.clone().applyMatrix4(childInvMat);
    const axis = { x: axisLocal.x, y: axisLocal.y, z: axisLocal.z };

    const joint = world.createImpulseJoint(
      RAPIER.JointData.revolute(anchor1, anchor2, axis),
      parentHandle.body,
      childHandle.body,
      true,
    ) as RAPIER.RevoluteImpulseJoint;
    joint.setLimits(limits.min, limits.max);
    joint.setContactsEnabled(false);
    joint.configureMotorPosition(0, LOCK_STIFFNESS, LOCK_DAMPING);

    return {
      name,
      joint,
      parent: parentHandle.body,
      child: childHandle.body,
      limits,
      axisLocal: axisLocal.clone(),
    };
  }

  function addFixedCuboid(
    position: Vector3,
    halfExtents: Vector3,
    restitution = 0,
    friction = 0.9,
  ) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z),
    );
    const shape = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setRestitution(restitution)
      .setFriction(friction)
      .setCollisionGroups(GROUND_GROUPS);
    world.createCollider(shape, body);
    return body;
  }

  function applyGravity(enabled: boolean) {
    gravityEnabled = enabled;
    world.gravity = enabled ? gravityOn : gravityOff;

    for (const object of dynamics) {
      const handle = meshMap.get(object);
      if (!handle) continue;
      if (enabled) {
        handle.body.wakeUp();
      } else {
        handle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        handle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  function setGravityEnabled(enabled: boolean) {
    pendingGravity = enabled;
  }

  const motors = new Map<string, MotorState>();

  function measuredHingeAngle(binding: HingeBinding) {
    const relative = copyRotation(binding.parent).invert().multiply(copyRotation(binding.child));
    const axis = binding.axisLocal;
    const imag = relative.x * axis.x + relative.y * axis.y + relative.z * axis.z;
    const angle = 2 * Math.atan2(imag, relative.w);
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  function hingeAngle(name: string) {
    return motors.get(name)?.currentAngle ?? 0;
  }

  function jointMotor(name: string): JointMotorState | null {
    const motor = motors.get(name);
    if (!motor) return null;
    return {
      angle: motor.currentAngle,
      target: motor.targetAngle,
      locked: motor.locked,
      min: motor.binding.limits.min,
      max: motor.binding.limits.max,
    };
  }

  function hingeError(current: number, target: number) {
    return Math.atan2(Math.sin(current - target), Math.cos(current - target));
  }

  function matchChildAngvelToParent(binding: HingeBinding) {
    const parentW = binding.parent.angvel();
    binding.child.setAngvel({ x: parentW.x, y: parentW.y, z: parentW.z }, true);
  }

  function snapChildToTarget(motor: MotorState) {
    const { binding } = motor;
    const parentRot = copyRotation(binding.parent);
    const delta = new Quaternion().setFromAxisAngle(binding.axisLocal, motor.targetAngle);
    const childRot = parentRot.clone().multiply(delta);
    binding.child.setRotation(
      { x: childRot.x, y: childRot.y, z: childRot.z, w: childRot.w },
      true,
    );
    matchChildAngvelToParent(binding);
    motor.currentAngle = motor.targetAngle;
  }

  function holdLocked(motor: MotorState) {
    const { binding } = motor;
    snapChildToTarget(motor);
    binding.joint.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
    binding.joint.configureMotor(motor.targetAngle, 0, LOCK_STIFFNESS, LOCK_DAMPING);
  }

  function applyTarget(motor: MotorState, target: number) {
    const { binding } = motor;
    const clamped = Math.max(binding.limits.min, Math.min(binding.limits.max, target));
    motor.targetAngle = clamped;
    motor.locked = false;
    binding.joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
    binding.joint.configureMotorPosition(clamped, SEEK_STIFFNESS, SEEK_DAMPING);
    binding.parent.wakeUp();
    binding.child.wakeUp();
  }

  function lockIfArrived(motor: MotorState) {
    if (motor.locked) {
      holdLocked(motor);
      return;
    }
    const error = hingeError(motor.currentAngle, motor.targetAngle);
    if (Math.abs(error) > ARRIVE_EPS) return;
    motor.locked = true;
    holdLocked(motor);
  }

  function bindHinge(binding: HingeBinding) {
    motors.set(binding.name, {
      binding,
      targetAngle: 0,
      pendingTarget: null,
      locked: true,
      currentAngle: 0,
    });
  }

  function setJointTarget(name: string, angle: number) {
    const motor = motors.get(name);
    if (motor) motor.pendingTarget = angle;
  }

  function step(delta: number) {
    if (pendingGravity !== null) {
      applyGravity(pendingGravity);
      pendingGravity = null;
    }
    for (const motor of motors.values()) {
      if (motor.pendingTarget !== null) {
        applyTarget(motor, motor.pendingTarget);
        motor.pendingTarget = null;
      } else if (motor.locked) {
        holdLocked(motor);
      }
    }

    world.timestep = Math.min(delta, 1 / 20);
    world.step();

    for (const motor of motors.values()) {
      motor.currentAngle = measuredHingeAngle(motor.binding);
      lockIfArrived(motor);
    }

    for (const object of dynamics) {
      const handle = meshMap.get(object);
      if (!handle) continue;
      const translation = handle.body.translation();
      object.position.set(translation.x, translation.y, translation.z);
      _quat.copy(handle.body.rotation()).multiply(handle.visualOffset);
      object.quaternion.copy(_quat);
    }
  }

  return {
    RAPIER,
    world,
    addMesh,
    addObject,
    addRevoluteJoint,
    addFixedCuboid,
    bindHinge,
    setJointTarget,
    hingeAngle,
    jointMotor,
    getHandle,
    setGravityEnabled,
    step,
  };
}

export type RapierPhysicsApi = Awaited<ReturnType<typeof RapierPhysics>>;
