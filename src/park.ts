// Free-skate park: a 60 × 60 m concrete square with low walls and props at all angles.
// Each prop is given by its centre (x, z), its yaw `rot` (rad, three.js convention: the prop's
// local +x points along (cos rot, 0, −sin rot)) and its size. Physics and visuals both build it in
// the prop's local frame (see course.ts), placed with propFrame().
import { finalize, span, type Obstacle } from "./course";

export const PARK_HALF = 30; // walls at ±30 m
export const SPAWN = { x: -4, z: 6, yaw: 0 };

const D = Math.PI / 180;
export const PARK_PROPS: Obstacle[] = [
  { type: "qp",      name: "北 U 台",   x: 0,   z: -28.45, rot: 90 * D,  h: 1.0, r: 2.2, top: 1.5, w: 7 },
  { type: "qp",      name: "南 U 台",   x: 0,   z: 28.45,  rot: -90 * D, h: 1.0, r: 2.2, top: 1.5, w: 7 },
  { type: "stairs",  name: "四階樓梯",  x: 16,  z: -10,   rot: 0,       h: 0.68, l: 2.6, top: 2.0, steps: 4, w: 3 },
  { type: "bank",    name: "斜坡平台",  x: 20,  z: 16,    rot: 180 * D, h: 0.6, l: 2.4, top: 2.2, w: 3 },
  { type: "funbox",  name: "Funbox",    x: -14, z: -2,    rot: 0,       h: 0.3, l: 1.1, top: 1.8, w: 2.4 },
  { type: "kicker",  name: "跳台",      x: -20, z: 12,    rot: 45 * D,  h: 0.28, l: 0.8, w: 1.6 },
  { type: "kicker",  name: "大跳台",    x: 8,   z: -20,   rot: 90 * D,  h: 0.34, l: 0.95, w: 1.6 },
  { type: "manual",  name: "Manual 台", x: 6,   z: 13,    rot: 0,       h: 0.16, l: 3.2, w: 1.4 },
  { type: "ledge",   name: "花崗岩台",  x: -24, z: 2,     rot: 90 * D,  h: 0.3, l: 3.0, w: 0.5 },
  { type: "rail",    name: "低欄杆",    x: -4,  z: -14,   rot: 0,       h: 0.2, w: 2.0 },
  { type: "rail",    name: "高欄杆",    x: 22,  z: 2,     rot: 90 * D,  h: 0.26, w: 2.0 },
  { type: "crate",   name: "木箱",      x: 12,  z: 4,     rot: 30 * D,  h: 0.22, l: 0.6, w: 1.0 },
  { type: "barrier", name: "護欄",      x: -22, z: -14,   rot: -45 * D, h: 0.22, l: 0.3, w: 1.2 },
  { type: "curb",    name: "花台",      x: -8,  z: 20,    rot: 90 * D,  h: 0.12, l: 1.4, w: 1.6 },
  { type: "cone",    name: "雙角錐",    x: 2,   z: 4,     rot: 0,       h: 0.28, pair: 0.6, w: 0.3 },
  { type: "cone",    name: "角錐",      x: -10, z: 8,     rot: 0,       h: 0.28, w: 0.3 },
].map((o) => finalize(o as Obstacle));

/** where a prop's local origin (its start, x = 0) sits in the world, and its yaw */
export function propFrame(o: Obstacle) {
  const yaw = o.rot ?? 0, c = Math.cos(yaw), s = Math.sin(yaw), half = span(o) / 2;
  return { ox: o.x - half * c, oz: (o.z ?? 0) + half * s, yaw, c, s };
}
/** world (x, z) → the prop's local (along, across) coordinates */
export function toLocal(o: Obstacle, x: number, z: number) {
  const f = propFrame(o), dx = x - f.ox, dz = z - f.oz;
  return { lx: dx * f.c - dz * f.s, lz: dx * f.s + dz * f.c };
}
/** is the point on (or within `margin` of) the prop's footprint? */
export function pointInProp(o: Obstacle, x: number, z: number, margin = 0) {
  const { lx, lz } = toLocal(o, x, z), w = o.w ?? 1.2;
  return lx > -margin && lx < span(o) + margin && Math.abs(lz) < w / 2 + margin;
}
/** nearest prop to a point, by distance to its footprint */
export function nearestProp(x: number, z: number) {
  let best = PARK_PROPS[0], bestD = Infinity;
  for (const o of PARK_PROPS) {
    const { lx, lz } = toLocal(o, x, z), w = o.w ?? 1.2;
    const dx = Math.max(0, -lx, lx - span(o)), dz = Math.max(0, Math.abs(lz) - w / 2);
    const d = Math.hypot(dx, dz);
    if (d < bestD) (bestD = d), (best = o);
  }
  return { prop: best, dist: bestD };
}
