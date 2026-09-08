import {
  Box3,
  type Group,
  type Mesh,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";

const _box = new Box3();
const _size = new Vector3();
const _center = new Vector3();

export const PART_NAMES = new Set([
  "Chassis",
  "ShoulderLeft2",
  "UpperLegLeft2",
  "LowerLegLeft2",
  "FootLeft2",
  "ShoulderRight2",
  "UpperLegRight2",
  "LowerLegRight2",
  "FootRight2",
]);

export type HingeAxis = "y" | "z";

export type HingeDef = {
  child: string;
  parent: string;
  axis: HingeAxis;
};

/** Shoulder yaws about parent +Y; upper/lower/foot pitch about parent +Z. */
export const LEFT_LEG_HINGES: HingeDef[] = [
  { child: "ShoulderLeft2", parent: "Chassis", axis: "y" },
  { child: "UpperLegLeft2", parent: "ShoulderLeft2", axis: "z" },
  { child: "LowerLegLeft2", parent: "UpperLegLeft2", axis: "z" },
  { child: "FootLeft2", parent: "LowerLegLeft2", axis: "z" },
];

export const RIGHT_LEG_HINGES: HingeDef[] = [
  { child: "ShoulderRight2", parent: "Chassis", axis: "y" },
  { child: "UpperLegRight2", parent: "ShoulderRight2", axis: "z" },
  { child: "LowerLegRight2", parent: "UpperLegRight2", axis: "z" },
  { child: "FootRight2", parent: "LowerLegRight2", axis: "z" },
];

export const LEG_HINGES: HingeDef[] = [...LEFT_LEG_HINGES, ...RIGHT_LEG_HINGES];

export const HINGE_LIMIT = Math.PI / 3;

export function hingeAxisVector(axis: HingeAxis) {
  return axis === "y" ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
}

export function hingeAxisLabel(axis: HingeAxis) {
  return axis === "y" ? "+Y" : "+Z";
}

export function findHingeDef(name: string) {
  return LEG_HINGES.find((hinge) => hinge.child === name) ?? null;
}

export function isMesh(object: Object3D): object is Mesh {
  return (object as Mesh).isMesh === true;
}

function depth(object: Object3D) {
  let n = 0;
  let current: Object3D | null = object;
  while (current) {
    n += 1;
    current = current.parent;
  }
  return n;
}

/**
 * Named glTF nodes become independent rigid bodies. Multi-primitive nodes
 * (a Group of meshes) stay together as one body.
 */
export function findPartRoots(root: Object3D): Object3D[] {
  const roots: Object3D[] = [];
  root.traverse((object) => {
    if (PART_NAMES.has(object.name)) roots.push(object);
  });
  return roots;
}

export function meshesOwnedBy(part: Object3D, parts: Set<Object3D>): Mesh[] {
  const meshes: Mesh[] = [];

  if (isMesh(part)) meshes.push(part);

  for (const child of part.children) {
    if (parts.has(child)) continue;
    child.traverse((object) => {
      if (parts.has(object) && object !== child) return;
      if (isMesh(object) && !parts.has(object)) meshes.push(object);
    });
  }

  return meshes;
}

export function flattenParts(scene: Group, parts: Object3D[]) {
  scene.updateMatrixWorld(true);

  const prepared = parts.map((part) => {
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    part.matrixWorld.decompose(position, quaternion, scale);
    return { part, position, quaternion, scale };
  });

  const deepestFirst = [...prepared].sort((a, b) => depth(b.part) - depth(a.part));
  for (const { part, position, quaternion, scale } of deepestFirst) {
    scene.add(part);
    part.position.copy(position);
    part.quaternion.copy(quaternion);
    part.scale.copy(scale);
  }
}

export function liftAboveGround(objects: Object3D[], clearance: number) {
  _box.makeEmpty();
  for (const object of objects) {
    object.updateWorldMatrix(true, true);
    _box.expandByObject(object);
  }
  if (_box.isEmpty()) return 0;

  const lift = clearance - _box.min.y;
  if (lift === 0) return 0;
  for (const object of objects) object.position.y += lift;
  return lift;
}

/** Geometric center of the mesh bounds. Not the authored rotation pivot. */
export function worldCenterOf(object: Object3D) {
  object.updateWorldMatrix(true, true);
  _box.setFromObject(object);
  return _box.getCenter(_center).clone();
}

/**
 * Blender object origin in world space. Rotatable parts are authored so
 * this sits at the parent attachment (the shoulder cylinder, not the
 * whole-mesh centroid).
 */
export function worldOriginOf(object: Object3D) {
  object.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixPosition(object.matrixWorld);
}

export function boundingBoxOf(objects: Object3D[]) {
  _box.makeEmpty();
  for (const object of objects) {
    object.updateWorldMatrix(true, true);
    _box.expandByObject(object);
  }
  return {
    box: _box.clone(),
    center: _box.getCenter(_center).clone(),
    size: _box.getSize(_size).clone(),
  };
}
