import {
  Color,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
} from "three";

import { isMesh } from "../modelParts";

const HIGHLIGHT = new Color(0x3aa0ff);
const EMISSIVE_KEY = "_baseEmissive";
const INTENSITY_KEY = "_baseEmissiveIntensity";

function eachStandardMaterial(material: Material | Material[], visit: (material: MeshStandardMaterial) => void) {
  const list = Array.isArray(material) ? material : [material];
  for (const entry of list) {
    const standard = entry as MeshStandardMaterial;
    if (standard.emissive) visit(standard);
  }
}

export function uniquifyMaterials(root: Object3D) {
  root.traverse((object) => {
    if (!isMesh(object)) return;
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => material.clone());
    } else {
      object.material = object.material.clone();
    }
  });
}

export function setSelectionHighlight(root: Object3D, selected: boolean) {
  root.traverse((object) => {
    if (!isMesh(object)) return;
    eachStandardMaterial(object.material, (material) => {
      if (selected) {
        if (!material.userData[EMISSIVE_KEY]) {
          material.userData[EMISSIVE_KEY] = material.emissive.clone();
          material.userData[INTENSITY_KEY] = material.emissiveIntensity;
        }
        material.emissive.copy(HIGHLIGHT);
        material.emissiveIntensity = 0.85;
      } else if (material.userData[EMISSIVE_KEY]) {
        material.emissive.copy(material.userData[EMISSIVE_KEY]);
        material.emissiveIntensity = material.userData[INTENSITY_KEY] ?? 1;
      }
    });
  });
}

export function findSelectablePart(object: Object3D | null): Object3D | null {
  let current = object;
  while (current) {
    if (current.userData.selectable) return current;
    current = current.parent;
  }
  return null;
}

export function roundCoord(value: number) {
  return Math.round(value * 1000) / 1000;
}
