import {
  AxesHelper,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import {
  boundingBoxOf,
  findHingeDef,
  findPartRoots,
  flattenParts,
  HINGE_LIMIT,
  hingeAxisLabel,
  hingeAxisVector,
  isMesh,
  LEG_HINGES,
  liftAboveGround,
  meshesOwnedBy,
  worldOriginOf,
} from "../modelParts";
import { RapierPhysics } from "../rapierPhysics";
import { findSelectablePart, roundCoord, setSelectionHighlight, uniquifyMaterials } from "./selection";
import type { JointControlState, PhysicsSceneApi, SelectionInfo } from "./types";

const MODEL_URL = `${import.meta.env.BASE_URL}models/two-legs_v0-1.gltf`;
const GROUND_SIZE = 40;
const GROUND_HALF_THICKNESS = 0.25;
const DROP_CLEARANCE = 0.35;
const CLICK_PX = 6;

export type CreatePhysicsSceneOptions = {
  onSelectionChange: (selection: SelectionInfo | null) => void;
  onJointChange: (state: JointControlState | null) => void;
};

function frameFrontView(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  center: Vector3,
  size: Vector3,
) {
  const span = Math.max(size.x, size.y, 1) * 1.7;
  const distance = Math.max(span, size.z + 4, 8);
  camera.position.set(center.x, center.y, center.z + distance);
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();
}

function enableShadows(root: Object3D) {
  root.traverse((object) => {
    if (isMesh(object)) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

function selectionFromPart(part: Object3D): SelectionInfo {
  return {
    name: part.name,
    x: roundCoord(part.position.x),
    y: roundCoord(part.position.y),
    z: roundCoord(part.position.z),
  };
}

function sameSelection(a: SelectionInfo | null, b: SelectionInfo | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.name === b.name && a.x === b.x && a.y === b.y && a.z === b.z;
}

let activeScene: PhysicsSceneApi | null = null;

export async function createPhysicsScene(
  host: HTMLElement,
  options: CreatePhysicsSceneOptions,
): Promise<PhysicsSceneApi> {
  activeScene?.dispose();
  activeScene = null;
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.shadowMap.enabled = true;
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x1a1d22);

  const camera = new PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.1, 200);
  camera.position.set(0, 1.6, 12);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 1.2, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0);
  controls.enableDamping = true;
  controls.update();

  const hemi = new HemisphereLight(0xdde7ff, 0x2a241c, 1.1);
  scene.add(hemi);

  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(6, 14, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 40;
  scene.add(sun);

  const ground = new Mesh(
    new PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new MeshStandardMaterial({ color: 0x3d4450, roughness: 0.95, metalness: 0.05 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = "Ground";
  scene.add(ground);

  const grid = new GridHelper(GROUND_SIZE, GROUND_SIZE, 0x6b7380, 0x2c313a);
  grid.position.y = 0.002;
  scene.add(grid);

  const axes = new AxesHelper(3);
  axes.position.y = 0.01;
  scene.add(axes);

  const physics = await RapierPhysics();
  physics.addFixedCuboid(
    new Vector3(0, -GROUND_HALF_THICKNESS, 0),
    new Vector3(GROUND_SIZE / 2, GROUND_HALF_THICKNESS, GROUND_SIZE / 2),
  );

  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const model = gltf.scene;
  uniquifyMaterials(model);
  enableShadows(model);
  scene.add(model);

  const parts = findPartRoots(model);
  const partSet = new Set(parts);
  flattenParts(model, parts);
  liftAboveGround(parts, DROP_CLEARANCE);

  const partsByName = new Map(parts.map((part) => [part.name, part]));
  const chassis = partsByName.get("Chassis");
  const physicsRotation = new Map<string, Object3D["quaternion"]>();
  if (chassis) physicsRotation.set("Chassis", chassis.quaternion.clone());
  for (const hinge of LEG_HINGES) {
    const parentRot = physicsRotation.get(hinge.parent);
    if (parentRot) physicsRotation.set(hinge.child, parentRot.clone());
  }

  const pickables: Object3D[] = [];
  for (const part of parts) {
    const meshes = meshesOwnedBy(part, partSet);
    part.userData.selectable = true;
    for (const mesh of meshes) {
      mesh.userData.selectableRoot = part;
      pickables.push(mesh);
    }
    if (meshes.length === 0) continue;
    physics.addObject(part, meshes, true, 0.05, physicsRotation.get(part.name));
  }

  // Chassis is the test stand: it can fall under gravity, but it must not
  // tip or spin when a motor fires. Otherwise the free body chain tumbles.
  const chassisBody = chassis ? physics.getHandle(chassis)?.body : null;
  if (chassisBody) {
    chassisBody.lockRotations(true, true);
    chassisBody.restrictTranslations(false, true, false, true);
    chassisBody.setAdditionalMass(20, true);
  }

  for (const hinge of LEG_HINGES) {
    const parent = partsByName.get(hinge.parent);
    const child = partsByName.get(hinge.child);
    if (!parent || !child) continue;
    const joint = physics.addRevoluteJoint(
      hinge.child,
      parent,
      child,
      worldOriginOf(child),
      hingeAxisVector(hinge.axis),
      { min: -HINGE_LIMIT, max: HINGE_LIMIT },
    );
    if (joint) physics.bindHinge(joint);
  }

  const { center, size } = boundingBoxOf(parts);
  frameFrontView(camera, controls, center, size);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let selected: Object3D | null = null;
  let lastSelection: SelectionInfo | null = null;
  let lastJoint: JointControlState | null = null;
  let pointerDown: { x: number; y: number } | null = null;
  let disposed = false;
  let frame = 0;

  function emitSelection(next: SelectionInfo | null) {
    if (sameSelection(lastSelection, next)) return;
    lastSelection = next;
    options.onSelectionChange(next);
  }

  function jointStateFor(part: Object3D | null): JointControlState | null {
    if (!part) return null;
    const def = findHingeDef(part.name);
    const motor = def ? physics.jointMotor(part.name) : null;
    return {
      name: part.name,
      angleDeg: motor ? roundCoord((motor.angle * 180) / Math.PI) : 0,
      targetDeg: motor ? roundCoord((motor.target * 180) / Math.PI) : 0,
      minDeg: motor ? roundCoord((motor.min * 180) / Math.PI) : 0,
      maxDeg: motor ? roundCoord((motor.max * 180) / Math.PI) : 0,
      axisLabel: def ? hingeAxisLabel(def.axis) : "",
      hinged: Boolean(def),
      locked: motor?.locked ?? true,
    };
  }

  function sameJoint(a: JointControlState | null, b: JointControlState | null) {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
      a.name === b.name &&
      a.angleDeg === b.angleDeg &&
      a.targetDeg === b.targetDeg &&
      a.minDeg === b.minDeg &&
      a.maxDeg === b.maxDeg &&
      a.axisLabel === b.axisLabel &&
      a.hinged === b.hinged &&
      a.locked === b.locked
    );
  }

  function emitJoint(next: JointControlState | null) {
    if (sameJoint(lastJoint, next)) return;
    lastJoint = next;
    options.onJointChange(next);
  }

  function selectPart(part: Object3D | null) {
    if (selected === part) return;
    if (selected) setSelectionHighlight(selected, false);
    selected = part;
    if (selected) setSelectionHighlight(selected, true);
    emitSelection(selected ? selectionFromPart(selected) : null);
    emitJoint(jointStateFor(selected));
  }

  function pickAt(clientX: number, clientY: number) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    const part = hits.length > 0 ? findSelectablePart(hits[0].object) : null;
    if (part && part === selected) {
      selectPart(null);
      return;
    }
    selectPart(part);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    pointerDown = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: PointerEvent) {
    if (event.button !== 0 || !pointerDown) return;
    const dx = event.clientX - pointerDown.x;
    const dy = event.clientY - pointerDown.y;
    pointerDown = null;
    if (dx * dx + dy * dy > CLICK_PX * CLICK_PX) return;
    pickAt(event.clientX, event.clientY);
  }

  function onResize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  window.addEventListener("resize", onResize);

  const timer = new Timer();

  function animate() {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    timer.update();
    physics.step(Math.min(timer.getDelta(), 1 / 20));
    if (selected) emitSelection(selectionFromPart(selected));
    emitJoint(jointStateFor(selected));
    controls.update();
    renderer.render(scene, camera);
  }

  animate();

  const api: PhysicsSceneApi = {
    setGravityEnabled(enabled: boolean) {
      physics.setGravityEnabled(enabled);
    },
    setJointTarget(name: string, angleDeg: number) {
      physics.setJointTarget(name, (angleDeg * Math.PI) / 180);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      if (activeScene === api) activeScene = null;
    },
  };
  activeScene = api;
  return api;
}
