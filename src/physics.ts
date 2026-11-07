import * as CANNON from "cannon-es";
import { OBST, TRACK_END, STAIR_TREAD, len, span, type Obstacle } from "./course";
import { PARK } from "./mode";
import { PARK_PROPS, PARK_HALF, SPAWN, propFrame, pointInProp, nearestProp } from "./park";

export type Phase = "roll" | "pop" | "air" | "land" | "crash";
export type ResultKind = "good" | "warn" | "bad";

export interface Force {
  p: CANNON.Vec3;
  dir: 1 | -1;
  mag: number;
  label: string;
  age: number;
}

/** tunables driven by the UI sliders */
export const P = { pop: 1, level: 1, target: 3.0 };

export type Trick = "kickflip" | "heelflip" | "shoveit";
export const TRICK_NAMES: Record<Trick, string> = { kickflip: "Kickflip", heelflip: "Heelflip", shoveit: "Shove-it" };

/** player input: the front foot only levels / catches the board while the player holds the level control;
 *  `trick` is a one-shot request consumed by the physics step.
 *  Park mode only: steer −1 (left) … 1 (right), throttle 1 = push, −1 = brake. */
export const input = { level: false, trick: null as Trick | null, steer: 0, throttle: 0 };

/** board geometry: deck half-thickness, half-width, wheel radius, wheel y, kick angle, kick half-length */
export const T = 0.007, HW = 0.105, R = 0.027, WY = -0.055, KICK = 0.36, KL = 0.06;
export const REST_Y = -WY + R;

/** park driving: top push speed, push force, brake and coast decelerations */
const MAX_PUSH = 6.5, PUSH_F = 16, BRAKE_A = 4, COAST_A = 0.15;

export const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
(world.solver as CANNON.GSSolver).iterations = 20;

const mGround = new CANNON.Material("ground");
const mWheel = new CANNON.Material("wheel");
const mDeck = new CANNON.Material("deck");
// wheels roll, so their contact is nearly frictionless along the ground; the wooden deck scrapes
world.addContactMaterial(new CANNON.ContactMaterial(mGround, mWheel, { friction: 0.0, restitution: 0.05 }));
world.addContactMaterial(new CANNON.ContactMaterial(mGround, mDeck, { friction: 0.5, restitution: 0.15 }));

const groundBody = new CANNON.Body({ mass: 0, material: mGround });
const gp = new CANNON.Plane();
gp.material = mGround;
groundBody.addShape(gp);
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

const EX = new CANNON.Vec3(1, 0, 0), EY = new CANNON.Vec3(0, 1, 0), EZ = new CANNON.Vec3(0, 0, 1);

/* ---------- prop colliders, built in each prop's local frame ---------- */
interface Frame { ox: number; oz: number; yaw: number }
const propBodies = new Map<CANNON.Body, Obstacle>();
let curProp: Obstacle | null = null;

/** static box: local centre (cx, cy, cz), half extents, pitched by rz about the prop's local z */
function box(f: Frame, cx: number, cy: number, hx: number, hy: number, hz: number, rz = 0, cz = 0) {
  const b = new CANNON.Body({ mass: 0, material: mGround });
  const s = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
  s.material = mGround;
  b.addShape(s);
  const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
  b.position.set(f.ox + cx * c + cz * sn, cy, f.oz - cx * sn + cz * c);
  const qy = new CANNON.Quaternion().setFromAxisAngle(EY, f.yaw);
  const qz = new CANNON.Quaternion().setFromAxisAngle(EZ, rz);
  b.quaternion.copy(qy.mult(qz));
  world.addBody(b);
  if (curProp) propBodies.set(b, curProp);
  return b;
}
/** a box whose top face runs from local (x0,y0) to (x1,y1) */
function slope(f: Frame, hz: number, x0: number, y0: number, x1: number, y1: number, th = 0.1) {
  const a = Math.atan2(y1 - y0, x1 - x0), l = Math.hypot(x1 - x0, y1 - y0);
  box(f, (x0 + x1) / 2 + (Math.sin(a) * th) / 2, (y0 + y1) / 2 - (Math.cos(a) * th) / 2, l / 2, th / 2, hz, a);
}

export interface Cone extends CANNON.Body { home: CANNON.Vec3 }
export const cones: Cone[] = [];
/** cone bodies per prop, for the visuals */
export const propCones = new Map<Obstacle, Cone[]>();

function buildColliders(o: Obstacle, f: Frame, hz: number) {
  curProp = o;
  const l = len(o), h = o.h;
  switch (o.type) {
    case "curb": case "crate": case "barrier": case "manual": case "ledge":
      box(f, l / 2, h / 2, l / 2, h / 2, hz);
      break;
    case "rail": // the rail collider reaches the ground: the rider can't pass under the bar
      box(f, 0.025, h / 2, 0.025, h / 2, hz);
      break;
    case "kicker":
      slope(f, hz, 0, 0, l, h);
      break;
    case "funbox": {
      const top = o.top!;
      slope(f, hz, 0, 0, l, h);
      box(f, l + top / 2, h / 2, top / 2, h / 2, hz);
      slope(f, hz, l + top, h, 2 * l + top, 0);
      break;
    }
    case "bank": // ramp up to a platform that ends in a drop
      slope(f, hz, 0, 0, l, h);
      box(f, l + o.top! / 2, h / 2, o.top! / 2, h / 2, hz);
      break;
    case "qp": { // curved transition (circle of radius r) up to a deck
      const r = o.r!, thMax = Math.acos(1 - h / r), N = 12;
      for (let i = 0; i < N; i++) {
        const a0 = (thMax * i) / N, a1 = (thMax * (i + 1)) / N;
        slope(f, hz, r * Math.sin(a0), r * (1 - Math.cos(a0)), r * Math.sin(a1), r * (1 - Math.cos(a1)), 0.16);
      }
      box(f, l + o.top! / 2, h / 2, o.top! / 2, h / 2, hz);
      box(f, l + o.top! - 0.04, h + 0.2, 0.04, 0.2, hz); // low guard at the back of the deck
      break;
    }
    case "stairs": { // bank up, top deck, then steps down; a sloped handrail on one side
      const n = o.steps!, top = o.top!, rise = h / n, x0 = l + top;
      slope(f, hz, 0, 0, l, h);
      box(f, l + top / 2, h / 2, top / 2, h / 2, hz);
      for (let i = 1; i < n; i++) box(f, x0 + (i - 0.5) * STAIR_TREAD, (h - i * rise) / 2, STAIR_TREAD / 2, (h - i * rise) / 2, hz);
      const rz = hz - 0.2, x1 = x0 + (n - 1) * STAIR_TREAD, railH = 0.85;
      const a = Math.atan2(-h + rise, x1 - x0), rl = Math.hypot(x1 - x0, h - rise);
      box(f, (x0 + x1) / 2, (h + rise) / 2 + railH, rl / 2, 0.025, 0.025, a, rz); // sloped bar
      box(f, x0, (h + railH) / 2, 0.025, (h + railH) / 2, 0.025, 0, rz); // top post
      box(f, x1, (rise + railH) / 2, 0.025, (rise + railH) / 2, 0.025, 0, rz); // bottom post
      break;
    }
    case "cone": {
      const list: Cone[] = [];
      const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
      for (const dx of o.pair ? [0, o.pair] : [0]) {
        const b = new CANNON.Body({ mass: 0.8, material: mGround, linearDamping: 0.1, angularDamping: 0.3 }) as Cone;
        b.addShape(new CANNON.Cylinder(0.02, 0.13, h, 12));
        const lx = 0.13 + dx;
        b.home = new CANNON.Vec3(f.ox + lx * c, h / 2, f.oz - lx * sn);
        b.position.copy(b.home);
        world.addBody(b);
        cones.push(b);
        list.push(b);
      }
      propCones.set(o, list);
      break;
    }
  }
  curProp = null;
}

if (PARK) {
  for (const o of PARK_PROPS) buildColliders(o, propFrame(o), (o.w ?? 1.2) / 2);
  // low walls around the square
  const wf: Frame = { ox: 0, oz: 0, yaw: 0 }, H = 0.35, L = PARK_HALF + 0.3;
  box(wf, 0, H / 2, L, H / 2, 0.15, 0, -L);
  box(wf, 0, H / 2, L, H / 2, 0.15, 0, L);
  box(wf, -L, H / 2, 0.15, H / 2, L);
  box(wf, L, H / 2, 0.15, H / 2, L);
} else {
  // course: every prop on the x axis, 1.2 m wide colliders
  for (const o of OBST) buildColliders(o, { ox: o.x, oz: 0, yaw: 0 }, 0.6);
}

function resetCones() {
  for (const c of cones) {
    c.position.copy(c.home);
    c.quaternion.set(0, 0, 0, 1);
    c.velocity.setZero();
    c.angularVelocity.setZero();
  }
}

/* ---------- skateboard: deck + kicktails + four wheel spheres ---------- */
export const board = new CANNON.Body({ mass: 2.6, material: mDeck, linearDamping: 0.01, angularDamping: 0.05 });
{
  const deck = new CANNON.Box(new CANNON.Vec3(0.3, T, HW));
  deck.material = mDeck;
  board.addShape(deck);
  for (const sgn of [1, -1]) {
    const q = new CANNON.Quaternion();
    q.setFromEuler(0, 0, sgn * KICK);
    const s = new CANNON.Box(new CANNON.Vec3(KL, T, HW));
    s.material = mDeck;
    board.addShape(s, new CANNON.Vec3(sgn * (0.3 + KL * Math.cos(KICK)), KL * Math.sin(KICK), 0), q);
  }
  for (const x of [-0.22, 0.22]) for (const z of [-0.11, 0.11]) {
    const s = new CANNON.Sphere(R);
    s.material = mWheel;
    board.addShape(s, new CANNON.Vec3(x, WY, z));
  }
}
const PITCH_ONLY = new CANNON.Vec3(0, 0, 1), FREE = new CANNON.Vec3(1, 1, 1);
// course: stay in the side-view plane and only pitch on the ground; park: move and turn anywhere
board.linearFactor = PARK ? new CANNON.Vec3(1, 1, 1) : new CANNON.Vec3(1, 1, 0);
board.angularFactor = PARK ? FREE : PITCH_ONLY;
world.addBody(board);

const TAIL = new CANNON.Vec3(-0.3 - 2 * KL * Math.cos(KICK), 2 * KL * Math.sin(KICK), 0);
export const NOSE = new CANNON.Vec3(0.3 + 2 * KL * Math.cos(KICK), 2 * KL * Math.sin(KICK), 0);

/* ---------- ollie state machine ---------- */
export const S = {
  state: "roll" as Phase,
  stateT: 0,
  maxH: 0,
  air: 0,
  landPitch: 0,
  stuckT: 0,
  offT: 0,
  forces: [] as Force[],
  levelTau: 0,
  coneHit: false,
  crashAt: 0,
  /** park: where to come back after a crash */
  respawn: { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw },
  /** trick done on this jump, whether the board has spun away from upright, and whether the feet caught it */
  trick: null as Trick | null,
  trickAway: false,
  trickDone: false,
  /** park: direction of travel at take-off (horizontal unit vector) and the board's yaw then */
  refX: 1,
  refZ: 0,
  refYaw: 0,
  /** board-centre height at take-off (course: always REST_Y, the flat ground) */
  baseY: REST_Y,
  /** park: recent horizontal speeds (newest last), to spot a hard hit */
  hist: [] as number[],
};

/* ---------- board orientation helpers (world frame) ---------- */
const _xb = new CANNON.Vec3(), _ub = new CANNON.Vec3(), _zb = new CANNON.Vec3();
/** board long axis (nose direction) */
const longAxis = () => board.quaternion.vmult(EX, _xb);
/** board deck normal (grip-tape side) */
const deckUp = () => board.quaternion.vmult(EY, _ub);
/** board side axis (toe side) */
const sideAxis = () => board.quaternion.vmult(EZ, _zb);
/** how far the board is rolled onto its edge (rad), ignoring pitch: π when upside down */
function tiltOf() {
  if (deckUp().y < 0) return Math.PI;
  return Math.asin(Math.min(1, Math.abs(sideAxis().y)));
}
const inAir = () => S.state === "air" || S.state === "pop";
/** line of travel (horizontal unit vector) the landing is judged against:
 *  course = +x; park = the board's own heading on the ground, the take-off direction in the air */
function travelRef(): [number, number] {
  if (!PARK) return [1, 0];
  if (S.state === "air") return [S.refX, S.refZ];
  const x = longAxis(), h = Math.hypot(x.x, x.z);
  return h > 1e-4 ? [x.x / h, x.z / h] : [S.refX, S.refZ];
}
/** heading that pitch is measured about: course = +x; park = the board's own horizontal heading,
 *  signed toward the line of travel, so the front foot always pushes along the board */
function pitchRef(): [number, number] {
  const [rx, rz] = travelRef();
  if (!PARK) return [rx, rz];
  const x = longAxis(), h = Math.hypot(x.x, x.z);
  if (h < 0.2) return [rx, rz];
  const sg = x.x * rx + x.z * rz < 0 ? -1 : 1;
  return [(sg * x.x) / h, (sg * x.z) / h];
}
/** how far the long axis has turned away from the line of travel, either way round (rad) */
function yawDevOf() {
  const x = longAxis(), [rx, rz] = travelRef();
  return Math.atan2(Math.abs(x.x * rz - x.z * rx), Math.abs(x.x * rx + x.z * rz));
}
/** horizontal axis the board pitches about (nose up = positive) */
function pitchAxis() {
  const [rx, rz] = pitchRef();
  return new CANNON.Vec3(-rz, 0, rx);
}
const DEG = Math.PI / 180;

/** yaw of the board's heading (three.js convention), for the rider and the camera */
export function boardYaw() {
  if (PARK && (inAir() || S.state === "crash")) return S.refYaw;
  const x = longAxis();
  return Math.hypot(x.x, x.z) > 1e-3 ? Math.atan2(-x.z, x.x) : S.refYaw;
}

export interface Hooks {
  result(text: string, kind?: ResultKind): void;
  landed(maxH: number, air: number, landPitch: number): void;
}
let hooks: Hooks = { result() {}, landed() {} };
export const setHooks = (h: Hooks) => (hooks = h);

let coneT = 0; // time since the board last touched a cone (s)
board.addEventListener("collide", (e: { body: CANNON.Body }) => {
  if (cones.includes(e.body as Cone)) coneT = 0;
  if (cones.includes(e.body as Cone) && !S.coneHit) {
    S.coneHit = true;
    hooks.result("踢倒角錐", "warn");
  }
});

const obstacleNear = () =>
  PARK ? nearestProp(board.position.x, board.position.z).prop : OBST.find((o) => o.x + span(o) > board.position.x - 0.6) ?? OBST[0];

/** nose-up angle of the long axis in the side view, folded to ±90° so a board turned 180° still reads right */
export function pitchOf() {
  const x = longAxis();
  if (!PARK) {
    let a = Math.atan2(x.y, x.x);
    if (a > Math.PI / 2) a -= Math.PI;
    else if (a < -Math.PI / 2) a += Math.PI;
    return a;
  }
  const [rx, rz] = pitchRef(), d = x.x * rx + x.z * rz;
  return Math.atan2(x.y * (d < 0 ? -1 : 1), Math.abs(d));
}

function enterAir(stateT: number) {
  S.state = "air";
  S.stateT = stateT;
  S.trick = null;
  S.trickAway = false;
  S.trickDone = false;
  board.angularFactor = FREE; // in the air the board can flip and spin
  if (PARK) {
    const v = board.velocity, hs = Math.hypot(v.x, v.z), x = longAxis(), hx = Math.hypot(x.x, x.z) || 1;
    // measure pitch and the landing against the way the board is travelling (nose first or fakie)
    let rx = x.x / hx, rz = x.z / hx;
    if (hs > 0.5) {
      rx = v.x / hs;
      rz = v.z / hs;
    }
    S.refX = rx;
    S.refZ = rz;
    S.refYaw = Math.atan2(-x.z, x.x);
    board.angularVelocity.y = 0; // the feet stop carving at take-off
  }
}
/** back on four wheels: keep only the pitch, and point the nose the way it pointed at take-off */
function settleBoard() {
  if (!PARK) {
    const p = pitchOf();
    board.quaternion.setFromEuler(0, 0, p);
    board.angularVelocity.set(0, 0, board.angularVelocity.z);
    board.angularFactor = PITCH_ONLY;
    return;
  }
  // a shove-it leaves the nose where the tail was: turn it back so the rider keeps the same stance
  const x = longAxis();
  let yaw = Math.atan2(-x.z, x.x);
  let dy = yaw - S.refYaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  if (Math.abs(dy) > Math.PI / 2) yaw += Math.PI;
  // pitch relative to the new heading
  const hx = Math.cos(yaw), hz = -Math.sin(yaw), d = x.x * hx + x.z * hz;
  const pitch = Math.atan2(x.y * (d < 0 ? -1 : 1), Math.abs(d));
  const qy = new CANNON.Quaternion().setFromAxisAngle(EY, yaw), qz = new CANNON.Quaternion().setFromAxisAngle(EZ, pitch);
  board.quaternion.copy(qy.mult(qz));
  const a = new CANNON.Vec3(-hz, 0, hx), wp = board.angularVelocity.dot(a);
  board.angularVelocity.copy(a.scale(wp));
}
const grounded = () => world.contacts.some((c) => c.bi === board || c.bj === board);
/** park: angle (deg) between the deck and the surface under it, signed like the pitch */
function surfaceAngle(pitch: number) {
  const n = new CANNON.Vec3();
  for (const c of world.contacts) {
    if (c.bi === board) n.vsub(c.ni, n);
    else if (c.bj === board) n.vadd(c.ni, n);
  }
  if (n.length() < 1e-6) return (pitch * 180) / Math.PI;
  n.normalize();
  const a = Math.acos(Math.max(-1, Math.min(1, deckUp().dot(n))));
  return ((pitch < 0 ? -1 : 1) * a * 180) / Math.PI;
}
export const canOllie = () => S.state === "roll";

function clearState() {
  board.angularVelocity.set(0, 0, 0);
  S.trick = null;
  S.trickDone = false;
  input.trick = null;
  S.state = "roll";
  S.stateT = 0;
  S.stuckT = 0;
  S.offT = 0;
  S.coneHit = false;
  resetCones();
}
/** course: start rolling at distance x */
export function resetTo(x: number) {
  if (PARK) return resetPark(SPAWN.x, SPAWN.z, SPAWN.yaw);
  board.position.set(x, REST_Y + 0.002, 0);
  board.velocity.set(P.target, 0, 0);
  board.quaternion.set(0, 0, 0, 1);
  board.angularFactor = PITCH_ONLY;
  clearState();
}
/** park: stand still at (x, z) facing yaw */
export function resetPark(x: number, z: number, yaw: number) {
  board.position.set(x, REST_Y + 0.002, z);
  board.velocity.set(0, 0, 0);
  board.quaternion.setFromAxisAngle(EY, yaw);
  board.angularFactor = FREE;
  S.refYaw = yaw;
  S.refX = Math.cos(yaw);
  S.refZ = -Math.sin(yaw);
  S.hist.length = 0;
  S.baseY = REST_Y;
  clearState();
}

function impulse(vec: CANNON.Vec3, worldPoint: CANNON.Vec3, label: string) {
  board.applyImpulse(vec, worldPoint.vsub(board.position));
  S.forces.push({ p: worldPoint.clone(), dir: vec.y > 0 ? 1 : -1, mag: Math.abs(vec.y), label, age: 0 });
}

export function ollie() {
  if (S.state !== "roll" || !grounded()) return;
  // 1 · back foot snaps the tail down; the rear wheels are the pivot the ground pushes back on
  const J = 6.2 * P.pop;
  impulse(new CANNON.Vec3(0, -J, 0), board.pointToWorldFrame(TAIL), "後腳壓板尾");
  impulse(new CANNON.Vec3(0, J, 0), board.pointToWorldFrame(new CANNON.Vec3(-0.22, WY - R, 0)), "後輪支點");
  S.state = "pop";
  S.stateT = 0;
  S.maxH = 0;
  S.air = 0;
  S.coneHit = false;
  if (PARK) {
    const x = longAxis();
    S.refYaw = Math.atan2(-x.z, x.x);
    S.baseY = board.position.y;
  }
  hooks.result("");
}

function crash(msg?: string) {
  const o = obstacleNear();
  S.state = "crash";
  S.stateT = 0;
  if (PARK) {
    // come back a little way behind the crash, clear of any prop
    const v = board.velocity, hs = Math.hypot(v.x, v.z), x = longAxis(), hx = Math.hypot(x.x, x.z) || 1;
    const dx = hs > 0.3 ? v.x / hs : x.x / hx, dz = hs > 0.3 ? v.z / hs : x.z / hx;
    const yaw = Math.atan2(-dz, dx);
    S.respawn = { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw };
    for (let back = 2; back <= 8; back += 0.5) {
      const px = board.position.x - dx * back, pz = board.position.z - dz * back;
      const inside = Math.abs(px) > PARK_HALF - 1.5 || Math.abs(pz) > PARK_HALF - 1.5 || PARK_PROPS.some((p) => pointInProp(p, px, pz, 0.8));
      if (!inside) {
        S.respawn = { x: px, z: pz, yaw };
        break;
      }
    }
  } else S.crashAt = Math.min(o.x, board.position.x + 3.2); // a missed catch on flat ground restarts right here
  const atWall = PARK && Math.max(Math.abs(board.position.x), Math.abs(board.position.z)) > PARK_HALF - 1;
  hooks.result(msg ?? (atWall ? "撞到圍牆" : `撞到${o.name}`), "bad");
}

/** 3b · tricks: the front foot flicks the board's edge (flip) or the back foot scoops the tail (shove-it) */
function startTrick(t: Trick) {
  const flip = t !== "shoveit";
  // regular stance, toes toward +z: a kickflip lifts the heel edge, i.e. spins about +x of the board
  const local = flip ? new CANNON.Vec3(t === "kickflip" ? 1 : -1, 0, 0) : new CANNON.Vec3(0, 1, 0);
  const axis = board.quaternion.vmult(local);
  const w = flip ? 16 : 8.5; // ≈ one full flip / half a turn within the airtime of a normal ollie
  board.angularVelocity.vadd(axis.scale(w), board.angularVelocity);
  S.trick = t;
  const at = board.pointToWorldFrame(flip ? NOSE : new CANNON.Vec3(-0.36, 0.02, 0));
  S.forces.push({ p: at, dir: -1, mag: 3, label: flip ? "前腳踢板" : "後腳掃板尾", age: 0 });
}

/** 3c · holding the level control while the board comes back round lets the feet catch it */
function catchBoard(dt: number) {
  const ub = deckUp(), xb = longAxis(), [rx, rz] = travelRef();
  const d = xb.x * rx + xb.z * rz, sg = d < 0 ? -1 : 1;
  // corrective spin that turns the deck up and the long axis back along the line of travel
  const err = ub.cross(EY).vadd(xb.cross(new CANNON.Vec3(sg * rx, 0, sg * rz)));
  const a = pitchAxis(), w = board.angularVelocity, k = Math.min(1, 30 * dt);
  // split into the pitch part (about a) and the rest; the rest is driven by the correction
  const wp = w.dot(a), ep = err.dot(a);
  const wr = w.vsub(a.scale(wp)), er = err.vsub(a.scale(ep));
  wr.vadd(er.scale(14).vsub(wr).scale(k), wr);
  // both feet are back on the deck, so they also press it flat (scaled by the 前腳帶平 slider)
  const wp2 = wp + (-12 * pitchOf() - wp) * k * Math.min(1, P.level);
  w.copy(wr.vadd(a.scale(wp2)));
  if (!S.trickDone && tiltOf() < 12 * DEG && yawDevOf() < 12 * DEG) {
    S.trickDone = true;
    S.forces.push({ p: board.position.clone(), dir: -1, mag: 4, label: "接板", age: 0 });
  }
}

/** park, wheels down: trucks steer, wheels grip sideways, the rider pushes or brakes */
function ride(dt: number) {
  const v = board.velocity, xb = longAxis(), zb = sideAxis(), m = board.mass;
  // steering: turning rate grows with speed like real trucks, with a little turn even when slow
  const sp = Math.hypot(v.x, v.z);
  const rate = Math.min(2.2, 0.5 + 0.35 * sp) * Math.max(0.3, Math.hypot(xb.x, xb.z));
  const w = board.angularVelocity;
  w.y += (-input.steer * rate - w.y) * Math.min(1, 20 * dt);
  // sideways grip: wheels don't skid, so the velocity follows the board's heading
  const vl = v.dot(zb);
  v.vsub(zb.scale(vl * Math.min(1, 25 * dt)), v);
  // push / brake / coast along the board
  const vf = v.dot(xb);
  if (input.throttle > 0.05) {
    if (vf < MAX_PUSH) board.applyForce(xb.scale(PUSH_F * input.throttle));
  } else if (sp > 0.05) {
    const decel = input.throttle < -0.05 ? BRAKE_A * -input.throttle : COAST_A;
    if (input.throttle < -0.05 && sp < 0.2) {
      v.x = 0;
      v.z = 0;
    } else board.applyForce(new CANNON.Vec3((-v.x / sp) * m * decel, 0, (-v.z / sp) * m * decel));
  }
}

export function physicsStep(dt: number) {
  S.stateT += dt;
  const pitch = pitchOf();
  const onGround = grounded();
  if (S.state === "roll") {
    input.trick = null; // tricks only start in the air
    if (PARK) {
      if (onGround) ride(dt);
      // a hard hit on a prop's face: the board stops dead within ~50 ms
      const hs = Math.hypot(board.velocity.x, board.velocity.z), was = S.hist.length ? Math.max(...S.hist) : 0;
      // (knocking a cone over slows the board but isn't a crash)
      coneT += dt;
      if (was > 1.5 && hs < was * 0.35 && coneT > 0.3) crash();
      else if (tiltOf() > 50 * DEG) crash("板子翻了");
      else if (Math.abs(pitch) > 1.35) crash();
    } else {
      if (onGround && board.velocity.x < P.target) board.applyForce(new CANNON.Vec3(12, 0, 0)); // rider keeps pushing
      S.stuckT = board.velocity.x < 0.4 ? S.stuckT + dt : 0;
      if (S.stuckT > 0.3 || Math.abs(pitch) > 1.2) crash();
    }
    // rolling off a kicker leaves the ground without an ollie: the rider still levels the board
    S.offT = onGround ? 0 : S.offT + dt;
    if (S.state === "roll" && S.offT > 0.06) {
      if (PARK) S.baseY = board.position.y;
      enterAir(0.12);
      S.maxH = 0;
      S.air = S.offT;
      S.coneHit = false;
    }
  } else if (S.state === "pop") {
    const tail = board.pointToWorldFrame(TAIL);
    // course: the tail reaches the ground; park: the tail drops below the deck it is riding on
    const struck = PARK ? tail.y < board.position.y - 0.065 : tail.y < 0.015;
    if (struck || S.stateT > 0.18) {
      // 2 · tail strikes the ground and rebounds; the rider's jump carries the board up
      impulse(new CANNON.Vec3(0, 1.0 * P.pop, 0), new CANNON.Vec3(tail.x, Math.max(tail.y, 0), tail.z), "板尾敲地");
      impulse(new CANNON.Vec3(0, 5.6 * P.pop, 0), board.position.clone(), "身體起跳");
      enterAir(0);
    }
  } else if (S.state === "air") {
    S.air += dt;
    // a request made at take-off waits until the board has risen enough that its edge clears the
    // ground once it starts rolling over (or a moment has passed on a weak pop)
    const clear = board.position.y - S.baseY > 0.07 || S.stateT > 0.15;
    if (input.trick && !S.trick && !onGround && clear) startTrick(input.trick);
    if (S.trick) input.trick = null;
    if (S.trick) {
      // the catch only works once the board has actually spun away and is coming back round
      const tilt = tiltOf(), yaw = yawDevOf();
      if (!S.trickAway && (tilt > 60 * DEG || yaw > 60 * DEG)) S.trickAway = true;
      if (S.trickAway && input.level && tilt < 45 * DEG && yaw < 45 * DEG) catchBoard(dt);
    }
    // 3 · while the player holds the level control, the front foot drags up the grip tape and
    //     presses the nose down: a PD torque toward level. Let go and the board keeps spinning.
    const a = pitchAxis();
    const tau = input.level ? -9 * P.level * pitch - 0.9 * P.level * board.angularVelocity.dot(a) : 0;
    board.torque.vadd(a.scale(tau), board.torque);
    S.levelTau = tau;
    S.maxH = Math.max(S.maxH, board.position.y - S.baseY);
    if (S.stateT > 0.12 && onGround) {
      S.landPitch = PARK ? surfaceAngle(pitch) : (pitch * 180) / Math.PI;
      S.levelTau = 0;
      // touchdown: the board has to be wheels-down and pointing along the run to be ridden away
      const hint = S.trick && !input.level ? "（要按住才會接板）" : "";
      if (tiltOf() > 30 * DEG) crash(S.trick ? "沒接住板子" + hint : "板子翻了");
      else if (yawDevOf() > 30 * DEG) crash("板子歪了" + hint);
      else {
        settleBoard();
        S.state = "land";
        S.stateT = 0;
      }
    }
  } else if (S.state === "land") {
    if (S.stateT < 0.08) board.applyForce(new CANNON.Vec3(0, -60, 0)); // 4 · feet press the board down
    if (PARK && onGround) ride(dt);
    if (S.stateT > 0.3) {
      const a = Math.abs(S.landPitch);
      if ((!PARK && board.velocity.x < 0.4) || Math.abs(pitchOf()) > (PARK ? 1.35 : 1.2)) crash();
      else {
        if (!S.coneHit) {
          const q = a < 8 ? "乾淨落地" : a < 20 ? "落地有點歪" : "板頭/板尾先著地";
          hooks.result(S.trick ? `${TRICK_NAMES[S.trick]} · ${q}` : q, a < 8 ? "good" : a < 20 ? "warn" : "bad");
        }
        hooks.landed(S.maxH, S.air, S.landPitch);
        S.state = "roll";
        S.stateT = 0;
      }
    }
  } else if (S.state === "crash") {
    input.trick = null;
    if (S.stateT > 1.4) {
      if (PARK) resetPark(S.respawn.x, S.respawn.z, S.respawn.yaw);
      else resetTo(Math.max(0, S.crashAt - 3.2));
    }
  }
  world.step(dt);
  if (PARK) {
    S.hist.push(Math.hypot(board.velocity.x, board.velocity.z));
    if (S.hist.length > 12) S.hist.shift();
  }
  if (PARK) {
    // left the square (jumped the wall): back to the middle
    if (Math.abs(board.position.x) > PARK_HALF + 1 || Math.abs(board.position.z) > PARK_HALF + 1 || board.position.y < -1)
      resetPark(SPAWN.x, SPAWN.z, SPAWN.yaw);
  } else if (board.position.x > TRACK_END) resetTo(0);
  S.forces.forEach((f) => (f.age += dt));
  S.forces = S.forces.filter((f) => f.age < 0.45);
}

/** horizontal speed (m/s) and the propBodies map, for the HUD */
export const speedOf = () => Math.hypot(board.velocity.x, board.velocity.z);
export { propBodies };
