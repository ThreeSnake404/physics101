# Physics101

Three.js + Rapier experiment for a two-legged walker. Click parts to inspect them, toggle gravity, and drive hinged joints with a servo-style angle slider.

## Run online

**Live demo:** [https://threesnake404.github.io/physics101/](https://threesnake404.github.io/physics101/)

## Run locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173/`).

## Build

```bash
npm run build
npm run preview
```

## Controls

- **Gravity** — start with gravity off; toggle on to drop the assembly onto the ground plane
- **Click a part** — shows name/position and a rotate panel for hinged parts
- **Target slider** — set a joint angle (±60°); the hinge drives there, then locks like an RC servo
- **Orbit** — drag to look around; front view has +Z toward the screen

## Joints

| Part | Parent | Axis |
|---|---|---|
| ShoulderLeft2 / ShoulderRight2 | Chassis | +Y |
| UpperLeg* | Shoulder* | +Z |
| LowerLeg* | UpperLeg* | +Z |
| Foot* | LowerLeg* | +Z |

Hinges use each part’s authored Blender origin as the pivot.

## Model

Runtime assets live in `public/models/` (`two-legs_v0-1.gltf` + `.bin`). Blender sources and earlier exports are also checked in at the repo root.
