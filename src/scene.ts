import * as THREE from "three";
import { OBST, TRACK_END, STAIR_TREAD, len, type Obstacle } from "./course";
import { PARK } from "./mode";
import { PARK_PROPS, PARK_HALF, propFrame } from "./park";
import { propCones, type Cone, T, HW, R, WY, KICK, KL } from "./physics";

export const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export const scene = new THREE.Scene();

export const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 10 });
scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 0.85), sun, sun.target);

/* ---------- concrete ground with expansion joints every metre ---------- */
const GROUND_L = PARK ? 2 * PARK_HALF + 20 : Math.ceil(TRACK_END + 30); // runs past the walls / both ends
const GROUND_W = PARK ? GROUND_L : 50;
const gc = document.createElement("canvas");
gc.width = gc.height = 256;
const gtex = new THREE.CanvasTexture(gc);
gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping;
gtex.repeat.set(GROUND_L, GROUND_W);
gtex.colorSpace = THREE.SRGBColorSpace;
const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_L, GROUND_W), new THREE.MeshStandardMaterial({ map: gtex, roughness: 1 }));
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.position.x = PARK ? 0 : TRACK_END / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

/* ---------- props ---------- */
const curbMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
const edgeMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.4 });
const zoneMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false });
const woodMat = new THREE.MeshStandardMaterial({ color: 0xc9a46b, roughness: 0.85 });
const plankMat = new THREE.MeshStandardMaterial({ color: 0x8f6c3e, roughness: 0.9 });
const railMat = new THREE.MeshStandardMaterial({ color: 0x3d4248, metalness: 0.6, roughness: 0.4 });
const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 });
const bandMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 });
const barrierMat = new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.55 });
const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd7342b, roughness: 0.55 });

export function add(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x: number, y: number, z = 0, parent: THREE.Object3D = scene) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}
/** extrude a side profile (local x, y) across the prop's width */
function prism(points: [number, number][], mat: THREE.Material, parent: THREE.Object3D, w: number) {
  const sh = new THREE.Shape(points.map(([px, py]) => new THREE.Vector2(px, py)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  return add(g, mat, 0, 0, 0, parent);
}
/** round bar between two local points */
function bar(a: THREE.Vector3, b: THREE.Vector3, r: number, parent: THREE.Object3D) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = add(new THREE.CylinderGeometry(r, r, d.length(), 12), railMat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, parent);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

export const coneViews: [THREE.Group, Cone][] = [];

/** build one prop in its local frame (start at x = 0, width w across z) */
function buildProp(o: Obstacle, g: THREE.Object3D, w: number) {
  const l = len(o), h = o.h;
  switch (o.type) {
    case "curb":
    case "manual":
      add(new THREE.BoxGeometry(l, h, w), curbMat, l / 2, h / 2, 0, g);
      add(new THREE.BoxGeometry(0.03, 0.03, w), edgeMat, 0.015, h - 0.015, 0, g); // steel edge guard
      if (o.type === "manual") add(new THREE.BoxGeometry(0.03, 0.03, w), edgeMat, l - 0.015, h - 0.015, 0, g);
      break;
    case "ledge":
      add(new THREE.BoxGeometry(l, h, w), curbMat, l / 2, h / 2, 0, g);
      for (const z of [-1, 1]) add(new THREE.BoxGeometry(l, 0.03, 0.03), edgeMat, l / 2, h - 0.015, z * (w / 2 - 0.015), g);
      break;
    case "crate":
      add(new THREE.BoxGeometry(l, h, w), woodMat, l / 2, h / 2, 0, g);
      for (let i = 1; i < 3; i++) add(new THREE.BoxGeometry(l + 0.01, 0.008, w + 0.01), plankMat, l / 2, (h * i) / 3, 0, g);
      break;
    case "barrier":
      // plastic road barrier: white body with red bands and a dark foot at each end
      add(new THREE.BoxGeometry(l, h, w), barrierMat, l / 2, h / 2, 0, g);
      for (let i = 0; i < 2; i++) add(new THREE.BoxGeometry(l + 0.01, h * 0.18, w + 0.01), stripeMat, l / 2, h * (0.35 + 0.35 * i), 0, g);
      for (const z of [-1, 1]) add(new THREE.BoxGeometry(l + 0.08, 0.03, 0.12), railMat, l / 2, 0.015, z * (w / 2 - 0.05), g);
      break;
    case "rail": {
      const b = add(new THREE.CylinderGeometry(0.025, 0.025, w, 16), railMat, 0.025, h - 0.025, 0, g);
      b.rotation.x = Math.PI / 2;
      for (const z of [-1, 1]) {
        add(new THREE.BoxGeometry(0.04, h - 0.025, 0.04), railMat, 0.025, (h - 0.025) / 2, z * (w / 2 - 0.05), g);
        add(new THREE.BoxGeometry(0.24, 0.012, 0.1), railMat, 0.025, 0.006, z * (w / 2 - 0.05), g);
      }
      break;
    }
    case "kicker":
      prism([[0, 0], [l, h], [l, 0]], woodMat, g, w);
      add(new THREE.BoxGeometry(0.03, 0.012, w), edgeMat, l - 0.015, h - 0.003, 0, g); // coping strip at the lip
      break;
    case "funbox":
      prism([[0, 0], [l, h], [l + o.top!, h], [2 * l + o.top!, 0]], woodMat, g, w);
      break;
    case "bank":
      prism([[0, 0], [l, h], [l + o.top!, h], [l + o.top!, 0]], curbMat, g, w);
      add(new THREE.BoxGeometry(0.03, 0.03, w), edgeMat, l + o.top! - 0.015, h - 0.015, 0, g);
      break;
    case "qp": {
      const r = o.r!, thMax = Math.acos(1 - h / r), N = 20, pts: [number, number][] = [];
      for (let i = 0; i <= N; i++) {
        const a = (thMax * i) / N;
        pts.push([r * Math.sin(a), r * (1 - Math.cos(a))]);
      }
      pts.push([l + o.top!, h], [l + o.top!, 0]);
      prism(pts, woodMat, g, w);
      const cop = add(new THREE.CylinderGeometry(0.03, 0.03, w, 16), edgeMat, l, h, 0, g); // coping pipe
      cop.rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.08, 0.4, w), curbMat, l + o.top! - 0.04, h + 0.2, 0, g); // guard at the back of the deck
      break;
    }
    case "stairs": {
      const n = o.steps!, top = o.top!, rise = h / n, x0 = l + top, x1 = x0 + (n - 1) * STAIR_TREAD;
      const pts: [number, number][] = [[0, 0], [l, h], [x0, h]];
      for (let i = 1; i < n; i++) pts.push([x0 + (i - 1) * STAIR_TREAD, h - i * rise], [x0 + i * STAIR_TREAD, h - i * rise]);
      pts.push([x1, 0]);
      prism(pts, curbMat, g, w);
      add(new THREE.BoxGeometry(0.03, 0.03, w), edgeMat, x0 - 0.015, h - 0.015, 0, g); // nosing on the top edge
      const rz = w / 2 - 0.2, railH = 0.85;
      bar(new THREE.Vector3(x0, h + railH, rz), new THREE.Vector3(x1, rise + railH, rz), 0.025, g);
      bar(new THREE.Vector3(x0, h, rz), new THREE.Vector3(x0, h + railH, rz), 0.022, g);
      bar(new THREE.Vector3(x1, rise, rz), new THREE.Vector3(x1, rise + railH, rz), 0.022, g);
      break;
    }
    case "cone":
      for (const b of propCones.get(o) ?? []) {
        const cg = new THREE.Group();
        scene.add(cg);
        add(new THREE.CylinderGeometry(0.02, 0.13, h, 20), coneMat, 0, 0, 0, cg);
        add(new THREE.CylinderGeometry(0.058, 0.082, 0.06, 20), bandMat, 0, 0.04, 0, cg);
        add(new THREE.BoxGeometry(0.3, 0.02, 0.3), coneMat, 0, -h / 2 + 0.01, 0, cg);
        coneViews.push([cg, b]);
      }
      break;
  }
}

/** course props keep their original visual widths */
const COURSE_W: Partial<Record<Obstacle["type"], number>> = { crate: 0.9, barrier: 1.1, rail: 1.3 };
if (PARK) {
  for (const o of PARK_PROPS) {
    const f = propFrame(o), g = new THREE.Group();
    g.position.set(f.ox, 0, f.oz);
    g.rotation.y = f.yaw;
    scene.add(g);
    buildProp(o, g, o.w ?? 1.2);
  }
  // low walls around the square
  const H = 0.35, L = PARK_HALF + 0.3;
  const walls: [number, number, number, number][] = [[0, -L, 2 * L, 0.3], [0, L, 2 * L, 0.3], [-L, 0, 0.3, 2 * L], [L, 0, 0.3, 2 * L]];
  for (const [x, z, sx, sz] of walls) add(new THREE.BoxGeometry(sx, H, sz), curbMat, x, H / 2, z);
} else {
  for (const o of OBST) {
    const g = new THREE.Group();
    g.position.x = o.x;
    scene.add(g);
    buildProp(o, g, COURSE_W[o.type] ?? 1.2);
    if (o.zone) {
      // suggested take-off zone for the board's centre
      const l = len(o), x0 = o.x - o.zone[1], x1 = o.x - o.zone[0];
      const z = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 0.5), zoneMat);
      z.rotation.x = -Math.PI / 2;
      if (o.type === "kicker") {
        // the zone sits on the ramp, near the lip
        const a = Math.atan2(o.h, l), mid = (x0 + x1) / 2;
        z.geometry = new THREE.PlaneGeometry((x1 - x0) / Math.cos(a), 0.5);
        z.rotation.set(-Math.PI / 2, a, 0, "XZY");
        z.position.set(mid, ((mid - o.x) / l) * o.h + 0.004, 0);
      } else z.position.set((x0 + x1) / 2, 0.002, 0);
      scene.add(z);
    }
  }
}

/* ---------- skateboard visual (matches the physics shapes) ---------- */
const wood = new THREE.MeshStandardMaterial({ color: 0xd8b98a, roughness: 0.8 });
const grip = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 1 });
const graphic = new THREE.MeshStandardMaterial({ roughness: 0.6 });
const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.7, roughness: 0.35 });
const urethane = new THREE.MeshStandardMaterial({ color: 0xf3efe2, roughness: 0.5 });
const deckMats = [wood, wood, grip, graphic, wood, wood];

export const boardG = new THREE.Group();
scene.add(boardG);
function deckPiece(l: number, x: number, y: number, rz: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(l, T * 2, HW * 2), deckMats);
  m.position.set(x, y, 0);
  m.rotation.z = rz;
  m.castShadow = true;
  boardG.add(m);
}
deckPiece(0.6, 0, 0, 0);
deckPiece(KL * 2, 0.3 + KL * Math.cos(KICK), KL * Math.sin(KICK), KICK);
deckPiece(KL * 2, -0.3 - KL * Math.cos(KICK), KL * Math.sin(KICK), -KICK);

export const wheels: THREE.Group[] = [];
for (const tx of [-0.22, 0.22]) {
  add(new THREE.BoxGeometry(0.06, 0.012, 0.08), metal, tx, -0.013, 0, boardG); // baseplate
  add(new THREE.BoxGeometry(0.03, 0.035, 0.04), metal, tx, -0.035, 0, boardG); // kingpin block
  const hanger = add(new THREE.CylinderGeometry(0.009, 0.009, 0.21, 12), metal, tx, WY, 0, boardG);
  hanger.rotation.x = Math.PI / 2;
  for (const z of [-0.11, 0.11]) {
    const spin = new THREE.Group();
    spin.position.set(tx, WY, z);
    const wh = add(new THREE.CylinderGeometry(R, R, 0.032, 24), urethane, 0, 0, 0, spin);
    wh.rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.012, 0.012, 0.034), grip, 0, 0.019, 0, spin); // dot so the spin is visible
    boardG.add(spin);
    wheels.push(spin);
  }
}

/* ---------- rider's shoes: they follow the board's position, heading and pitch, but not its flip/spin ---------- */
export const feetG = new THREE.Group();
scene.add(feetG);
const shoeMat = new THREE.MeshStandardMaterial({ color: 0x2d3540, roughness: 0.9 });
const soleMat = new THREE.MeshStandardMaterial({ color: 0xf1f0ea, roughness: 0.9 });
function makeShoe() {
  const g = new THREE.Group();
  add(new THREE.BoxGeometry(0.095, 0.06, 0.26), shoeMat, 0, 0.04, 0, g);
  add(new THREE.BoxGeometry(0.1, 0.018, 0.27), soleMat, 0, 0.009, 0, g);
  feetG.add(g);
  return g;
}
export const backShoe = makeShoe();
export const frontShoe = makeShoe();

/* ---------- theme: colours follow the CSS tokens (light / dark) ---------- */
export const forceColors = { push: new THREE.Color(), up: new THREE.Color() };
export function applyTheme() {
  const bg = new THREE.Color(css("--bg"));
  scene.background = bg;
  scene.fog = PARK ? new THREE.Fog(bg, 10, 45) : new THREE.Fog(bg, 5, 18);
  graphic.color.set(css("--accent"));
  curbMat.color.set(css("--curb"));
  edgeMat.color.set(css("--curb-edge"));
  zoneMat.color.set(css("--accent"));
  forceColors.push.set(css("--push"));
  forceColors.up.set(css("--accent"));
  const g = gc.getContext("2d")!;
  g.fillStyle = css("--ground");
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.fillStyle = css("--joint");
  g.fillRect(0, 0, 4, 256);
  gtex.needsUpdate = true;
}
