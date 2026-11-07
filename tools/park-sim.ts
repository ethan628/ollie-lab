// Headless checks for the free-skate park (run: npm run sim:park).
import "./setmode-park";
import { span } from "../src/course";
import { PARK_PROPS, propFrame } from "../src/park";
import { S, board, input, ollie, physicsStep, resetPark, setHooks, speedOf, boardYaw, type Trick } from "../src/physics";

const msgs: string[] = [];
setHooks({ result: (t) => t && msgs.push(t), landed() {} });
const DT = 1 / 240;
let crashes = 0;
function step(sec: number, each?: (t: number) => void) {
  for (let t = 0; t < sec; t += DT) {
    each?.(t);
    const was = S.state;
    physicsStep(DT);
    if (S.state === "crash" && was !== "crash") crashes++;
  }
}
function start(x: number, z: number, yaw: number, speed: number) {
  resetPark(x, z, yaw);
  board.velocity.set(Math.cos(yaw) * speed, 0, -Math.sin(yaw) * speed);
  Object.assign(input, { level: false, trick: null, steer: 0, throttle: 0 });
  msgs.length = 0;
  crashes = 0;
  step(0.05);
}
const log = (name: string, ok: boolean, detail = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(34)} ${detail}`);
const r2 = (v: number) => v.toFixed(2);

// 1 · stand still at spawn
start(-4, 6, 0, 0);
step(2);
log("idle at spawn", S.state === "roll" && crashes === 0, `speed ${r2(speedOf())}`);

// 2 · push up to speed, then brake
start(-4, 6, 0, 0);
input.throttle = 1;
step(2.5);
const top = speedOf();
input.throttle = -1;
step(2);
log("push then brake", top > 5 && speedOf() < 0.05 && crashes === 0, `top ${r2(top)} m/s → ${r2(speedOf())}`);

// 3 · steering: grip keeps velocity along the board
start(-4, 6, 0, 3);
input.throttle = 0.3;
input.steer = 1;
step(1.2);
{
  const v = board.velocity, yaw = boardYaw(), vy = Math.atan2(-v.z, v.x);
  const slip = Math.abs(Math.atan2(Math.sin(vy - yaw), Math.cos(vy - yaw)));
  log("steer right", yaw < -0.8 && slip < 0.15 && crashes === 0, `yaw ${r2(yaw)} rad, slip ${r2(slip)} rad`);
}

// 4 · ollie / tricks while turning, landings judged along the heading
for (const t of [null, "kickflip", "heelflip", "shoveit"] as (Trick | null)[]) {
  start(-4, 6, 0.5, 4);
  input.steer = 0.4;
  step(0.3);
  input.level = true;
  ollie();
  if (t) input.trick = t;
  step(1.25); // take-off to riding away
  const res = msgs.filter((m) => m).join(" | ");
  log(`turning ${t ?? "ollie"}`, crashes === 0 && /落地/.test(res), res);
}
// a trick without holding is not caught
start(-4, 6, 0.5, 4);
ollie();
input.trick = "kickflip";
step(1.2);
log("kickflip, no hold → crash", crashes === 1, msgs.join(" | "));

// 5 · each prop: ride straight into it along its local +x
function approach(o: (typeof PARK_PROPS)[number], dist: number, speed: number) {
  const f = propFrame(o);
  start(f.ox - f.c * dist, f.oz + f.s * dist, f.yaw, speed);
}
function along(o: (typeof PARK_PROPS)[number]) {
  const f = propFrame(o), dx = board.position.x - f.ox, dz = board.position.z - f.oz;
  return dx * f.c - dz * f.s;
}
for (const o of PARK_PROPS) {
  const solid = ["rail", "crate", "barrier", "ledge", "curb", "manual"].includes(o.type);
  if (solid) {
    // no ollie: must not pass through
    approach(o, 4, 4);
    input.throttle = 0.5;
    step(2.5);
    const through = along(o) > span(o) + 0.3 && crashes === 0 && board.position.y < o.h + 0.05;
    log(`${o.name}: ride into it`, !through, crashes ? msgs.at(-1) ?? "" : `along ${r2(along(o))}`);
    // ollie at a sensible distance (sweep a few)
    let best = "";
    for (const d of [0.9, 1.1, 1.3, 1.5]) {
      approach(o, 4, 4);
      input.level = true;
      let popped = false;
      step(2.6, () => {
        if (!popped && along(o) > -d) (popped = true), ollie();
      });
      if (crashes === 0 && along(o) > span(o)) best += `${d} `;
    }
    log(`${o.name}: ollie over/onto`, best.length > 0, `ok at ${best || "none"}m before`);
  } else if (o.type === "kicker" || o.type === "funbox" || o.type === "bank") {
    approach(o, 4, 4.5);
    input.level = true;
    step(3);
    log(`${o.name}: ride over`, crashes === 0 && along(o) > span(o), `along ${r2(along(o))} ${msgs.join(" | ")}`);
  } else if (o.type === "qp") {
    approach(o, 5, 4.5);
    let maxY = 0, back = false;
    step(4, () => {
      maxY = Math.max(maxY, board.position.y);
      if (along(o) < -2) back = true;
    });
    log(`${o.name}: up and back down`, crashes === 0 && maxY > 0.5 && back, `max y ${r2(maxY)} ${msgs.join(" | ")}`);
  } else if (o.type === "stairs") {
    approach(o, 3, 5);
    input.level = true;
    input.throttle = 0.6;
    let popped = false, maxY = 0;
    const edge = (o.l ?? 0) + (o.top ?? 0);
    step(2.2, () => {
      maxY = Math.max(maxY, board.position.y);
      if (!popped && along(o) > edge - 0.5) (popped = true), ollie(), (input.throttle = 0);
    });
    log(`${o.name}: up the bank, jump the stairs`, crashes === 0 && along(o) > span(o) + 0.5 && maxY > 0.68, `max y ${r2(maxY)}, along ${r2(along(o))} ${msgs.join(" | ")}`);
  } else if (o.type === "cone") {
    approach(o, 4, 4);
    step(2);
    log(`${o.name}: ride into it`, msgs.some((m) => m.includes("角錐")), msgs.join(" | "));
  }
}

// 6 · the stair handrail can't be passed through
{
  const o = PARK_PROPS.find((p) => p.type === "stairs")!, f = propFrame(o);
  // ride along the stairs' width toward the rail post at the bottom (from the side)
  const x1 = (o.l ?? 0) + (o.top ?? 0) + (o.steps! - 1) * 0.34, railZ = (o.w ?? 3) / 2 - 0.2;
  const px = f.ox + x1 * f.c + (railZ + 3) * f.s, pz = f.oz - x1 * f.s + (railZ + 3) * f.c;
  start(px, pz, f.yaw + Math.PI / 2, 4); // local −z direction
  step(2);
  log("stair rail post: solid", crashes > 0 && board.position.z < -7.5, msgs.join(" | "));
}

// 7 · walls
start(26, -2, 0, 5);
input.throttle = 1;
step(2);
log("ride into the wall", crashes > 0 && msgs.includes("撞到圍牆"), msgs.join(" | "));
