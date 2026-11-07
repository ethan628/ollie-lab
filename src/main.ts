import "./style.css";
import * as THREE from "three";
import { OBST } from "./course";
import { P, S, R, T, REST_Y, NOSE, board, input, TRICK_NAMES, type Trick, ollie, physicsStep, pitchOf, resetTo, resetPark, setHooks, canOllie, boardYaw, speedOf, type Force, type ResultKind } from "./physics";
import { PARK } from "./mode";
import { PARK_PROPS, SPAWN, nearestProp, propFrame } from "./park";
import { joy, mountJoystick } from "./joystick";
import { scene, sun, boardG, feetG, wheels, backShoe, frontShoe, coneViews, forceColors, applyTheme } from "./scene";
import { updateRider } from "./rider";

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
const stage = $("stage");
const canvas = $<HTMLCanvasElement>("c");
$("sub").textContent = PARK ? `自由滑 · ${PARK_PROPS.length} 個道具` : `練習場 · 物理板子 · ${OBST.length} 個障礙`;
document.body.classList.toggle("park", PARK);

/* ================= renderer + camera ================= */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);

applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

/* ---------- orbit: drag to rotate, wheel / pinch to zoom ---------- */
let az = PARK ? 0.3 : 0.42, el = PARK ? 0.26 : 0.16, dist = PARK ? 4.4 : 4.0, narrow = false;
const camTarget = new THREE.Vector3(0.45, 0.62, 0);
/** park: smoothed direction the chase camera looks along */
let camYaw = PARK ? SPAWN.yaw : 0;
const pts = new Map<number, { x: number; y: number }>();
let pinch0 = 0, dist0 = dist;
const clampDist = (d: number) => Math.min(8, Math.max(1.5, d));
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
    dist0 = dist;
  }
});
canvas.addEventListener("pointermove", (e) => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  if (pts.size === 1) {
    az -= (e.clientX - p.x) * 0.008;
    el = Math.min(1.3, Math.max(0.03, el + (e.clientY - p.y) * 0.006));
  }
  p.x = e.clientX;
  p.y = e.clientY;
  if (pts.size === 2 && pinch0) {
    const [a, b] = [...pts.values()];
    dist = clampDist((dist0 * pinch0) / Math.hypot(a.x - b.x, a.y - b.y));
  }
});
const up = (e: PointerEvent) => {
  pts.delete(e.pointerId);
  pinch0 = 0;
};
canvas.addEventListener("pointerup", up);
canvas.addEventListener("pointercancel", up);
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  dist = clampDist(dist * (1 + e.deltaY * 0.001));
}, { passive: false });

function resize() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  narrow = camera.aspect < 0.9; // portrait phone: wider FOV, camera pulled back
  camera.fov = narrow ? 58 : 40;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

/* ================= UI ================= */
let slow = false, showArrows = true;
const phaseNames: Record<typeof S.state, string> = { roll: "滑行", pop: "① 壓板尾", air: "② 空中帶平", land: "③ 落地", crash: "摔車" };
let resultTimer: number | undefined;
function showResult(txt: string, kind: ResultKind = "good") {
  const r = $("result");
  clearTimeout(resultTimer);
  if (!txt) {
    r.classList.remove("show");
    return;
  }
  r.textContent = txt;
  r.dataset.k = kind;
  r.classList.add("show");
  resultTimer = window.setTimeout(() => r.classList.remove("show"), 1600);
}
setHooks({
  result: showResult,
  landed(maxH, air, landPitch) {
    $("rH").innerHTML = `${Math.round(maxH * 100)}<small>cm</small>`;
    $("rA").innerHTML = `${air.toFixed(2)}<small>s</small>`;
    $("rP").innerHTML = `${landPitch.toFixed(1)}<small>°</small>`;
  },
});

// Controls. Anything the player is holding (a key, the OLLIE button, a trick button) keeps the
// front foot working: it levels the board and catches a flipping board on its way back round.
//   Space / OLLIE      press = ollie, hold = level / catch      (↑ / W also hold)
//   ← A / → D / ↓ S    and the trick buttons: on the ground = ollie + that trick in one go,
//                      in the air = start the trick; keep holding to catch it
const holds = new Set<string>();
const hold = (id: string, on: boolean) => {
  if (on) holds.add(id);
  else holds.delete(id);
  input.level = holds.size > 0;
};
// Course: ← → ↓ are the tricks, Space / ↑ / W hold to level.
// Park:   ← → / A D steer, ↑ / W push, ↓ / S brake (or the joystick); Z X C are the tricks, Space holds.
const TRICK_KEYS: Record<string, Trick> = PARK
  ? { KeyZ: "kickflip", KeyX: "heelflip", KeyC: "shoveit" }
  : { ArrowLeft: "kickflip", KeyA: "kickflip", ArrowRight: "heelflip", KeyD: "heelflip", ArrowDown: "shoveit", KeyS: "shoveit" };
const LEVEL_KEYS = new Set(PARK ? ["Space"] : ["Space", "ArrowUp", "KeyW"]);
const DRIVE_KEYS: Record<string, [number, number]> = PARK
  ? { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1] }
  : {};
const driveHeld = new Set<string>();
addEventListener("keydown", (e) => {
  if (!DRIVE_KEYS[e.code] || (e.target as HTMLElement).tagName === "INPUT") return;
  e.preventDefault();
  driveHeld.add(e.code);
});
addEventListener("keyup", (e) => driveHeld.delete(e.code));
addEventListener("blur", () => driveHeld.clear());
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
function readDrive() {
  let sx = 0, sy = 0;
  for (const k of driveHeld) (sx += DRIVE_KEYS[k][0]), (sy += DRIVE_KEYS[k][1]);
  input.steer = clamp1(joy.x + sx);
  input.throttle = clamp1(joy.y + sy);
}
if (PARK) {
  const j = $("joy");
  j.hidden = false;
  mountJoystick(j);
  const keys = ["Z", "X", "C"];
  document.querySelectorAll<HTMLElement>(".tricks kbd").forEach((k, i) => (k.textContent = keys[i]));
  $("keys").textContent = "← → 轉向 · ↑ 推 · ↓ 煞車 · 空白 Ollie · Z X C 招式 · 按住 = 帶平 / 接板";
  $("reset").textContent = "回到中央";
}
const modeBtn = $("mode");
modeBtn.textContent = PARK ? "練習場" : "自由滑";
// the world is built once at load: switch through the hash (it also works on an artifact link) and reload
modeBtn.onclick = () => {
  const u = new URL(location.href);
  u.searchParams.delete("mode");
  u.searchParams.delete("at");
  u.hash = PARK ? "" : "park";
  history.replaceState(null, "", u);
  location.reload();
};
addEventListener("hashchange", () => location.reload());
function doTrick(t: Trick) {
  if (canOllie()) ollie(); // a flip trick is an ollie with a flick: one press does both
  input.trick = t;
}
addEventListener("keydown", (e) => {
  const t = TRICK_KEYS[e.code];
  if ((!t && !LEVEL_KEYS.has(e.code)) || (e.target as HTMLElement).tagName === "INPUT") return;
  e.preventDefault();
  hold("key:" + e.code, true);
  if (e.repeat) return;
  if (t) doTrick(t);
  else if (e.code === "Space") ollie();
});
addEventListener("keyup", (e) => {
  if (!TRICK_KEYS[e.code] && !LEVEL_KEYS.has(e.code)) return;
  e.preventDefault(); // stop Space from also "clicking" a focused button
  hold("key:" + e.code, false);
});
addEventListener("blur", () => {
  holds.clear();
  input.level = false;
});
function holdButton(btn: HTMLElement, press: () => void) {
  btn.addEventListener("pointerdown", (e) => {
    btn.setPointerCapture(e.pointerId);
    hold("ptr:" + e.pointerId, true);
    press();
  });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"] as const)
    btn.addEventListener(ev, (e) => hold("ptr:" + e.pointerId, false));
  btn.addEventListener("click", (e) => {
    if (e.detail === 0) press(); // keyboard activation (Enter) without a pointer
  });
}
holdButton($("ollie"), ollie);
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-trick]")) {
  const t = b.dataset.trick as Trick;
  holdButton(b, () => doTrick(t));
}
for (const [id, key, dp] of [["pop", "pop", 2], ["level", "level", 1]] as const) {
  const inp = $<HTMLInputElement>(id), out = $(id + "V");
  const sync = () => {
    P[key] = +inp.value;
    out.textContent = (+inp.value).toFixed(dp);
  };
  inp.addEventListener("input", sync);
  sync();
}
$("slow").onclick = (e) => {
  slow = !slow;
  (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(slow));
};
$("arrows").onclick = (e) => {
  showArrows = !showArrows;
  (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(showArrows));
};
$("reset").onclick = () => {
  resetTo(0);
  showResult("");
};

/* ================= force arrows + labels ================= */
const arrows = Array.from({ length: 5 }, () => {
  const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.3, 0xffffff, 0.07, 0.05);
  a.visible = false;
  scene.add(a);
  return a;
});
const labelBox = $("labels");
const labels = arrows.map(() => {
  const d = document.createElement("div");
  d.className = "flabel";
  d.hidden = true;
  labelBox.appendChild(d);
  return d;
});
const v3 = new THREE.Vector3();
function drawForces(yaw: number) {
  const r = stage.getBoundingClientRect();
  const sx = Math.sin(yaw) * 0.13, sz = Math.cos(yaw) * 0.13;
  const list: Force[] = showArrows ? [...S.forces] : [];
  if (showArrows && S.state === "air" && S.stateT < 0.35 && Math.abs(S.levelTau) > 0.15) {
    list.push({ p: board.pointToWorldFrame(NOSE), dir: S.levelTau < 0 ? -1 : 1, mag: Math.min(6, Math.abs(S.levelTau) * 2), label: "前腳帶平", age: 0 });
  }
  arrows.forEach((a, i) => {
    const f = list[i];
    if (!f) {
      a.visible = false;
      labels[i].hidden = true;
      return;
    }
    const l = 0.08 + f.mag * 0.035;
    a.position.set(f.p.x + sx, f.p.y - (f.dir < 0 ? -l : 0), f.p.z + sz);
    a.setDirection(v3.set(0, f.dir, 0));
    a.setLength(l, 0.06, 0.045);
    a.setColor(f.dir < 0 ? forceColors.push : forceColors.up);
    a.visible = true;
    v3.set(f.p.x + sx, f.p.y + (f.dir > 0 ? l : l * 0.3), f.p.z + sz).project(camera);
    const lb = labels[i];
    lb.textContent = f.label;
    lb.className = "flabel " + (f.dir < 0 ? "down" : "up");
    lb.hidden = false;
    lb.style.left = ((v3.x + 1) / 2) * r.width + "px";
    lb.style.top = ((1 - v3.y) / 2) * r.height + (i % 2) * 18 + "px";
  });
}

/* ================= loop ================= */
const FIXED = 1 / 240;
let acc = 0, prev = performance.now(), lastPhase = "", trickLift = 0;
const look = new THREE.Vector3(), fwd = new THREE.Vector3();
function frame(now: number) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  const simDt = dt * (slow ? 0.25 : 1);
  if (PARK) readDrive();
  acc += simDt;
  while (acc >= FIXED) {
    physicsStep(FIXED);
    acc -= FIXED;
  }

  boardG.position.copy(board.position as unknown as THREE.Vector3);
  boardG.quaternion.copy(board.quaternion as unknown as THREE.Quaternion);
  fwd.set(1, 0, 0).applyQuaternion(boardG.quaternion);
  const spinRate = (board.velocity.x * fwd.x + board.velocity.y * fwd.y + board.velocity.z * fwd.z) / R;
  wheels.forEach((w) => (w.rotation.z -= spinRate * simDt));

  // feet: back foot rides the tail; front foot slides toward the nose in the air and lifts a little.
  // They follow the board's position and pitch only, so a flip or shove-it turns the board under them,
  // and while a trick is spinning (not yet caught) both feet pull up out of the way.
  feetG.position.copy(boardG.position);
  const yaw = PARK ? boardYaw() : 0;
  feetG.rotation.set(0, yaw, pitchOf(), "YZX");
  const spinning = S.state === "air" && !!S.trick && !S.trickDone;
  trickLift += ((spinning ? 0.13 : 0) - trickLift) * (1 - Math.exp(-(spinning ? 30 : 18) * simDt));
  const airT = S.state === "air" ? Math.min(1, S.stateT / 0.18) : S.state === "land" ? Math.max(0, 1 - S.stateT / 0.2) : 0;
  const lift = (S.state === "air" ? 0.05 * Math.sin(Math.min(1, S.stateT / 0.45) * Math.PI) : 0) + trickLift;
  backShoe.position.set(-0.3, T + lift * 0.6, 0.02);
  backShoe.rotation.y = 0.35;
  frontShoe.position.set(0.04 + 0.15 * airT, T + lift, 0.0);
  frontShoe.rotation.y = -0.2;
  backShoe.visible = frontShoe.visible = S.state !== "crash";
  feetG.updateMatrixWorld(true);
  updateRider(simDt, yaw);

  if (PARK) {
    // chase camera: sits behind the way the board is travelling (or pointing, when slow) and turns with it
    const v = board.velocity, hs = Math.hypot(v.x, v.z);
    const want = S.state === "crash" ? camYaw : hs > 0.8 ? Math.atan2(-v.z, v.x) : yaw;
    let dy = want - camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    camYaw += dy * (1 - Math.exp(-(hs > 0.8 ? 3 : 1.5) * dt));
    const hx = Math.cos(camYaw), hz = -Math.sin(camYaw);
    look.set(board.position.x + hx * 0.8, board.position.y + (narrow ? 0.75 : 0.65), board.position.z + hz * 0.8);
    camTarget.lerp(look, 1 - Math.exp(-8 * dt));
    const d = dist * (narrow ? 1.3 : 1), a = camYaw - Math.PI / 2 + az;
    camera.position.set(
      camTarget.x + d * Math.cos(el) * Math.sin(a),
      camTarget.y + d * Math.sin(el),
      camTarget.z + d * Math.cos(el) * Math.cos(a),
    );
  } else {
    // camera follows the board
    look.set(board.position.x + 0.45, (narrow ? 0.8 : 0.7) + Math.max(0, board.position.y - REST_Y) * 0.7, 0);
    camTarget.lerp(look, 1 - Math.exp(-8 * dt));
    const d = dist * (narrow ? 1.35 : 1);
    camera.position.set(
      camTarget.x + d * Math.cos(el) * Math.sin(az),
      camTarget.y + d * Math.sin(el),
      camTarget.z + d * Math.cos(el) * Math.cos(az),
    );
  }
  camera.lookAt(camTarget);
  sun.position.set(board.position.x + 1.5, board.position.y + 3, board.position.z + 2);
  sun.target.position.set(board.position.x, board.position.y, board.position.z);

  drawForces(yaw);

  const ph =
    S.state === "air" && S.trick ? (S.trickDone ? "② 接板" : `② ${TRICK_NAMES[S.trick]} · 按住接板`) : phaseNames[S.state];
  if (ph !== lastPhase) {
    $("phase").textContent = ph;
    $("phase").classList.toggle("on", S.state !== "roll");
    lastPhase = ph;
  }
  $("rLive").innerHTML = `${((pitchOf() * 180) / Math.PI).toFixed(0)}<small>°</small>`;
  ($("ollie") as HTMLButtonElement).disabled = !canOllie();
  if (PARK) {
    const n = nearestProp(board.position.x, board.position.z);
    $("next").textContent = `${(speedOf() * 3.6).toFixed(0)} km/h · 附近：${n.prop.name} ${n.dist.toFixed(1)} m`;
  } else {
    const ahead = OBST.find((o) => o.x > board.position.x + 0.4);
    $("next").textContent = ahead
      ? `下一個：${ahead.name} ${Math.round(ahead.h * 100)} cm · ${(ahead.x - board.position.x - 0.42).toFixed(1)} m` +
        (ahead.type === "kicker" ? " · 衝到台頂再按" : ahead.type === "funbox" ? " · 可直接滑過" : "")
      : "終點，馬上回到起點";
  }
  for (const [g, b] of coneViews) {
    g.position.copy(b.position as unknown as THREE.Vector3);
    g.quaternion.copy(b.quaternion as unknown as THREE.Quaternion);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ?at=95 starts the run at that distance (handy for practising one obstacle)
const startAt = PARK ? 0 : Math.max(0, Number(new URLSearchParams(location.search).get("at")) || 0);
resetTo(startAt);
// ?mode=park&prop=N starts 5 m in front of prop N, facing it (handy for practising one prop)
const propQ = new URLSearchParams(location.search).get("prop"), propN = propQ === null ? NaN : Number(propQ);
const startProp = PARK && Number.isInteger(propN) && propN >= 0 ? PARK_PROPS[propN] : undefined;
if (startProp) {
  const f = propFrame(startProp);
  resetPark(f.ox - f.c * 5, f.oz + f.s * 5, f.yaw);
  camYaw = f.yaw;
}
if (PARK) camTarget.set(board.position.x + 0.8, 0.65, board.position.z);
else camTarget.x = startAt + 0.45;
resize();
requestAnimationFrame(frame);
