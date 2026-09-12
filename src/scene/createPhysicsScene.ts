import {
  AxesHelper,
  Camera,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
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
import type {
  JointControlState,
  PhysicsSceneApi,
  PresetViewName,
  SelectionInfo,
  ViewState,
} from "./types";

const MODEL_URL = `${import.meta.env.BASE_URL}models/two-legs_v0-1.gltf`;
const GROUND_SIZE = 40;
const GROUND_HALF_THICKNESS = 0.25;
const DROP_CLEARANCE = 0.35;
const CLICK_PX = 6;

export type CreatePhysicsSceneOptions = {
  onSelectionChange: (selection: SelectionInfo | null) => void;
  onJointChange: (state: JointControlState | null) => void;
  onViewStateChange?: (state: ViewState) => void;
};

function isTypingInput(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const textTypes = ["text", "password", "email", "number", "search", "tel", "url"];
    return textTypes.includes(el.type);
  }
  return false;
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

  const aspect = host.clientWidth / Math.max(host.clientHeight, 1);
  const perspCamera = new PerspectiveCamera(50, aspect, 0.1, 500);
  const orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  let isOrtho = false;
  let activeCamera: Camera = perspCamera;

  const controls = new OrbitControls<Camera>(activeCamera, renderer.domElement);
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
  const span = Math.max(size.x, size.y, 1) * 1.7;
  const defaultDistance = Math.max(span, size.z + 4, 8);

  function applyFrontView() {
    perspCamera.position.set(center.x, center.y, center.z + defaultDistance);
    perspCamera.up.set(0, 1, 0);
    perspCamera.lookAt(center);
    perspCamera.updateProjectionMatrix();

    const halfFovRad = (perspCamera.fov * Math.PI) / 360;
    const halfHeight = defaultDistance * Math.tan(halfFovRad);
    const halfWidth = halfHeight * (host.clientWidth / Math.max(host.clientHeight, 1));
    orthoCamera.left = -halfWidth;
    orthoCamera.right = halfWidth;
    orthoCamera.top = halfHeight;
    orthoCamera.bottom = -halfHeight;
    orthoCamera.zoom = 1;
    orthoCamera.position.set(center.x, center.y, center.z + defaultDistance);
    orthoCamera.up.set(0, 1, 0);
    orthoCamera.lookAt(center);
    orthoCamera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.update();
  }

  applyFrontView();

  let lastViewState: ViewState | null = null;

  function detectPresetView(): PresetViewName | null {
    const target = controls.target;
    const dir = new Vector3().subVectors(activeCamera.position, target).normalize();
    const EPS = 0.03;

    // Front: +Z points directly at screen
    if (Math.abs(dir.x) < EPS && Math.abs(dir.y) < EPS && Math.abs(dir.z - 1) < EPS) {
      return "front";
    }
    // Top: +Y points directly at screen
    if (Math.abs(dir.x) < EPS && Math.abs(dir.y - 1) < EPS && Math.abs(dir.z) < EPS) {
      return "top";
    }
    // Right: +X points directly at screen
    if (Math.abs(dir.x - 1) < EPS && Math.abs(dir.y) < EPS && Math.abs(dir.z) < EPS) {
      return "right";
    }
    return null;
  }

  function emitViewState() {
    const activeView = detectPresetView();
    if (
      lastViewState &&
      lastViewState.isOrtho === isOrtho &&
      lastViewState.activeView === activeView
    ) {
      return;
    }
    lastViewState = { isOrtho, activeView };
    options.onViewStateChange?.(lastViewState);
  }

  function setView(view: PresetViewName) {
    const target = controls.target;
    let distance: number;

    if (isOrtho) {
      const halfH = ((orthoCamera.top - orthoCamera.bottom) / 2) / orthoCamera.zoom;
      const halfFovRad = (perspCamera.fov * Math.PI) / 360;
      distance = halfH / Math.tan(halfFovRad);
    } else {
      distance = perspCamera.position.distanceTo(target);
    }

    if (distance < 0.5 || !Number.isFinite(distance)) {
      distance = defaultDistance;
    }

    let offset: Vector3;
    if (view === "front") {
      // 1. Number pad 1: Front view, where z axis points directly at the view screen.
      offset = new Vector3(0, 0, distance);
    } else if (view === "top") {
      // 2. Number pad 7: Top view, where y axis points directly at the view screen.
      offset = new Vector3(0, distance, 0.0001);
    } else {
      // 3. Number pad 3: Right view, where x axis points directly at the view screen.
      offset = new Vector3(distance, 0, 0);
    }

    const newPos = target.clone().add(offset);

    perspCamera.position.copy(newPos);
    perspCamera.up.set(0, 1, 0);
    perspCamera.lookAt(target);
    perspCamera.updateProjectionMatrix();

    orthoCamera.position.copy(newPos);
    orthoCamera.up.set(0, 1, 0);
    orthoCamera.lookAt(target);
    orthoCamera.updateProjectionMatrix();

    controls.target.copy(target);
    controls.update();
    emitViewState();
  }

  function toggleOrthoPersp() {
    const target = controls.target;
    const width = host.clientWidth;
    const height = Math.max(host.clientHeight, 1);
    const aspect = width / height;
    const halfFovRad = (perspCamera.fov * Math.PI) / 360;

    if (!isOrtho) {
      // Switch to Orthographic
      const distance = perspCamera.position.distanceTo(target);
      const halfHeight = distance * Math.tan(halfFovRad);
      const halfWidth = halfHeight * aspect;

      orthoCamera.left = -halfWidth;
      orthoCamera.right = halfWidth;
      orthoCamera.top = halfHeight;
      orthoCamera.bottom = -halfHeight;
      orthoCamera.zoom = 1;
      orthoCamera.position.copy(perspCamera.position);
      orthoCamera.quaternion.copy(perspCamera.quaternion);
      orthoCamera.up.copy(perspCamera.up);
      orthoCamera.updateProjectionMatrix();

      isOrtho = true;
      activeCamera = orthoCamera;
      controls.object = orthoCamera;
      controls.update();
    } else {
      // Switch to Perspective
      const halfHeight = ((orthoCamera.top - orthoCamera.bottom) / 2) / orthoCamera.zoom;
      let distance = halfHeight / Math.tan(halfFovRad);
      if (distance < 0.5 || !Number.isFinite(distance)) {
        distance = defaultDistance;
      }
      const dir = new Vector3().subVectors(orthoCamera.position, target).normalize();
      if (dir.lengthSq() === 0) dir.set(0, 0, 1);

      perspCamera.position.copy(target).addScaledVector(dir, distance);
      perspCamera.quaternion.copy(orthoCamera.quaternion);
      perspCamera.up.copy(orthoCamera.up);
      perspCamera.updateProjectionMatrix();

      isOrtho = false;
      activeCamera = perspCamera;
      controls.object = perspCamera;
      controls.update();
    }

    emitViewState();
  }

  emitViewState();

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
    raycaster.setFromCamera(pointer, activeCamera);
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
    const aspect = width / height;

    perspCamera.aspect = aspect;
    perspCamera.updateProjectionMatrix();

    const currentHalfHeight = (orthoCamera.top - orthoCamera.bottom) / 2;
    orthoCamera.left = -currentHalfHeight * aspect;
    orthoCamera.right = currentHalfHeight * aspect;
    orthoCamera.updateProjectionMatrix();

    renderer.setSize(width, height);
  }

  function onControlsChange() {
    emitViewState();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    if (isTypingInput(document.activeElement)) return;

    if (event.code === "Numpad1" || event.key === "1") {
      event.preventDefault();
      setView("front");
    } else if (event.code === "Numpad7" || event.key === "7") {
      event.preventDefault();
      setView("top");
    } else if (event.code === "Numpad3" || event.key === "3") {
      event.preventDefault();
      setView("right");
    } else if (event.code === "Numpad5" || event.key === "5") {
      event.preventDefault();
      toggleOrthoPersp();
    }
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKeyDown);
  controls.addEventListener("change", onControlsChange);

  const timer = new Timer();

  function animate() {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    timer.update();
    physics.step(Math.min(timer.getDelta(), 1 / 20));
    if (selected) emitSelection(selectionFromPart(selected));
    emitJoint(jointStateFor(selected));
    controls.update();
    renderer.render(scene, activeCamera);
  }

  animate();

  const api: PhysicsSceneApi = {
    setGravityEnabled(enabled: boolean) {
      physics.setGravityEnabled(enabled);
    },
    setJointTarget(name: string, angleDeg: number) {
      physics.setJointTarget(name, (angleDeg * Math.PI) / 180);
    },
    setView(view: PresetViewName) {
      setView(view);
    },
    toggleOrthoPersp() {
      toggleOrthoPersp();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      controls.removeEventListener("change", onControlsChange);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      if (activeScene === api) activeScene = null;
    },
  };
  activeScene = api;
  return api;
}
