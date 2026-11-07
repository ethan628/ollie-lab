// Prop data shared by the straight course and the free-skate park.
// Every prop is built in its own local frame: x runs along the prop from its start (0) to `span`,
// y is up, z is across (width `w`). Course props sit on the x axis at `x`; park props are placed
// by their centre (x, z) and turned by `rot` (yaw, rad) — see park.ts.
// zone = board-centre distance before x where an ollie at default power clears it (course only).

export type ObstacleType =
  | "curb" | "cone" | "kicker" | "rail" | "crate" | "funbox" | "barrier"
  | "qp" | "manual" | "stairs" | "bank" | "ledge";

export interface Obstacle {
  type: ObstacleType;
  name: string;
  x: number;
  h: number;
  l?: number;
  top?: number;
  pair?: number;
  zone?: [number, number];
  /** park only: centre z, yaw and width across the prop */
  z?: number;
  rot?: number;
  w?: number;
  /** quarter pipe transition radius */
  r?: number;
  /** stair set: number of risers down from the top deck */
  steps?: number;
  /** total footprint along the run, filled in by finalize() */
  span?: number;
}

export const STAIR_TREAD = 0.34;

/** fill in derived lengths so physics and visuals agree */
export function finalize(o: Obstacle) {
  if (o.type === "rail") o.l = 0.05;
  else if (o.type === "cone") o.l = o.pair ? o.pair + 0.26 : 0.26;
  else if (o.type === "qp") {
    const r = o.r!, th = Math.acos(1 - o.h / r);
    o.l = r * Math.sin(th); // horizontal length of the curved transition
  }
  const l = o.l ?? 0, top = o.top ?? 0;
  if (o.type === "funbox") o.span = 2 * l + top;
  else if (o.type === "qp" || o.type === "bank") o.span = l + top;
  else if (o.type === "stairs") o.span = l + top + (o.steps! - 1) * STAIR_TREAD + 0.05;
  else o.span = l;
  return o;
}

export const OBST: Obstacle[] = [
  { type: "curb",   name: "路緣",   x: 6,  h: 0.08, l: 0.6,  zone: [0.6, 1.8] },
  { type: "cone",   name: "角錐",   x: 12, h: 0.28,           zone: [0.7, 1.5] },
  { type: "curb",   name: "路緣",   x: 18, h: 0.14, l: 0.8,  zone: [0.5, 1.05] },
  { type: "kicker", name: "跳台",   x: 25, h: 0.25, l: 0.75, zone: [-0.7, -0.4] },
  { type: "rail",   name: "低欄杆", x: 33, h: 0.18,           zone: [0.7, 1.7] },
  { type: "crate",  name: "木箱",   x: 40, h: 0.2,  l: 0.5,  zone: [0.7, 1.3] },
  { type: "funbox", name: "Funbox", x: 47, h: 0.25, l: 1.0,  top: 1.6 },
  { type: "cone",   name: "雙角錐", x: 57, h: 0.28, pair: 0.6, zone: [0.7, 0.9] },
  { type: "curb",   name: "長平台", x: 64, h: 0.14, l: 2.4,  zone: [0.5, 1.9] },
  { type: "rail",   name: "高欄杆", x: 72, h: 0.26,           zone: [0.9, 1.7] },
  { type: "kicker", name: "大跳台", x: 79, h: 0.34, l: 0.95, zone: [-0.75, -0.55] },
  { type: "crate",  name: "高木箱", x: 87, h: 0.26, l: 0.6,  zone: [0.9, 1.2] },
  // second half (zones swept in the headless simulation, level held)
  { type: "barrier", name: "護欄",     x: 95,  h: 0.22, l: 0.3,  zone: [0.8, 1.45] },
  { type: "curb",    name: "花台",     x: 102, h: 0.1,  l: 1.2,  zone: [0.8, 2.0] },
  { type: "cone",    name: "角錐",     x: 109, h: 0.28,           zone: [0.7, 1.55] },
  { type: "kicker",  name: "中跳台",   x: 116, h: 0.3,  l: 0.85, zone: [-0.7, -0.5] },
  { type: "rail",    name: "中欄杆",   x: 124, h: 0.22,           zone: [0.8, 1.85] },
  { type: "crate",   name: "長木箱",   x: 131, h: 0.22, l: 1.5,  zone: [0.85, 1.85] },
  { type: "funbox",  name: "大 Funbox", x: 138, h: 0.32, l: 1.1,  top: 2.0 },
  { type: "barrier", name: "高護欄",   x: 148, h: 0.3,  l: 0.35, zone: [0.95, 1.35] },
  { type: "curb",    name: "高路緣",   x: 155, h: 0.18, l: 0.5,  zone: [0.65, 1.3] },
  { type: "cone",    name: "雙角錐",   x: 162, h: 0.28, pair: 0.5, zone: [0.7, 1.05] },
  { type: "rail",    name: "超高欄杆", x: 169, h: 0.3,            zone: [0.95, 1.65] },
  { type: "crate",   name: "大木箱",   x: 176, h: 0.27, l: 0.6,  zone: [0.9, 1.2] },
];

export const TRACK_END = 185;

OBST.forEach(finalize);

export const len = (o: Obstacle) => o.l ?? 0;
export const span = (o: Obstacle) => o.span ?? 0;
