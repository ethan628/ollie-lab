import * as THREE from "three";
import { OBST, span } from "./course";
import { S, board } from "./physics";
import { PARK } from "./mode";
import { scene, backShoe, frontShoe } from "./scene";

/* Procedural rider: regular stance, facing +z (toward the default camera).
   Legs are solved with 2-bone IK to the shoes on the deck. */

const skinMat = new THREE.MeshStandardMaterial({ color: 0xd6a27a, roughness: 0.7 });
export const shirtMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.9 });
const capMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.8 });

// riderRoot follows the board (position and heading); the rig is posed in its local frame,
// where +x is the way the board points. riderG carries the fall animation inside it.
const riderRoot = new THREE.Group();
scene.add(riderRoot);
const riderG = new THREE.Group();
riderRoot.add(riderG);
const UP = new THREE.Vector3(0, 1, 0);

/** unit-height cylinder stretched between two joints each frame */
function limb(r: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.88, 1, 14), mat);
  m.castShadow = true;
  riderG.add(m);
  return m;
}
function ball(r: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
  m.castShadow = true;
  riderG.add(m);
  return m;
}

const RIG = {
  thighB: limb(0.068, pantsMat), shinB: limb(0.052, pantsMat),
  thighF: limb(0.068, pantsMat), shinF: limb(0.052, pantsMat),
  kneeB: ball(0.058, pantsMat), kneeF: ball(0.058, pantsMat), pelvis: ball(0.13, pantsMat),
  torso: new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.28, 6, 16), shirtMat),
  uArmB: limb(0.045, shirtMat), fArmB: limb(0.037, skinMat),
  uArmF: limb(0.045, shirtMat), fArmF: limb(0.037, skinMat),
  elbB: ball(0.04, skinMat), elbF: ball(0.04, skinMat), handB: ball(0.045, skinMat), handF: ball(0.045, skinMat),
  neck: limb(0.045, skinMat), head: ball(0.105, skinMat),
  cap: new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat),
  brim: new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.15), capMat),
};
RIG.torso.scale.set(1.2, 1, 0.78);
RIG.torso.castShadow = true;
riderG.add(RIG.torso);
RIG.head.add(RIG.cap);
RIG.cap.position.y = 0.015;
RIG.head.add(RIG.brim);
RIG.brim.position.set(0.12, 0.03, 0); // cap faces the direction of travel

const _d = new THREE.Vector3(), _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _z = new THREE.Vector3();
function place(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  _d.subVectors(b, a);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.scale.y = _d.length();
  mesh.quaternion.setFromUnitVectors(UP, _d.normalize());
}
function placeTorso(hip: THREE.Vector3, chest: THREE.Vector3) {
  _d.subVectors(chest, hip).normalize();
  _x.set(1, 0, 0).addScaledVector(_d, -_d.x).normalize();
  _z.crossVectors(_x, _d);
  _m.makeBasis(_x, _d, _z);
  RIG.torso.quaternion.setFromRotationMatrix(_m);
  RIG.torso.position.addVectors(hip, chest).multiplyScalar(0.5);
}

const L1 = 0.43, L2 = 0.43;
/** law of cosines in the plane spanned by hip→ankle and the pole */
function solveKnee(hip: THREE.Vector3, ankle: THREE.Vector3, pole: THREE.Vector3, out: THREE.Vector3) {
  const ax = new THREE.Vector3().subVectors(ankle, hip);
  const d = Math.min(ax.length(), L1 + L2 - 1e-4);
  ax.normalize();
  const a = (L1 * L1 + d * d - L2 * L2) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const bend = pole.clone().addScaledVector(ax, -pole.dot(ax)).normalize();
  return out.copy(hip).addScaledVector(ax, a).addScaledVector(bend, h);
}

const JOINTS = ["hip", "hipB", "hipF", "ankB", "ankF", "kneeB", "kneeF", "chest", "shB", "shF", "elbB", "elbF", "handB", "handF", "neck", "head"] as const;
type JointName = (typeof JOINTS)[number];
const mk = () => Object.fromEntries(JOINTS.map((k) => [k, new THREE.Vector3()])) as Record<JointName, THREE.Vector3>;
const J = mk();
const POSE = { H: 0.74, arm: 0.35, lean: 0.2 };
const FALL = { on: false, t: 0, pivot: new THREE.Vector3(), snap: mk() };

/** hip height above the ankles (H), arm raise and torso lean follow the ollie phases */
function riderTargets() {
  const st = S.state, t = S.stateT;
  const o = PARK ? undefined : OBST.find((q) => q.zone && q.x + span(q) > board.position.x - 0.3);
  const d = o ? o.x - board.position.x : 99;
  const ready = !!o && d < o.zone![1] + 1.0 && d > o.zone![0] - 0.4; // skaters crouch while setting up
  if (st === "pop") return { H: 0.86, arm: 1.25, lean: 0.25, k: 28 }; // explode upward, arms swing
  if (st === "air")
    return t < 0.3
      ? { H: 0.46, arm: 1.05, lean: 0.4, k: 16 } // knees tuck to the chest
      : { H: 0.62, arm: 0.85, lean: 0.35, k: 9 }; // legs reach for the landing
  if (st === "land") return { H: t < 0.12 ? 0.5 : 0.7, arm: 0.6, lean: 0.45, k: 14 }; // absorb, then stand
  return ready ? { H: 0.56, arm: 0.6, lean: 0.5, k: 7 } : { H: 0.74, arm: 0.35, lean: 0.2, k: 5 };
}

const _v = new THREE.Vector3();
export function updateRider(dt: number, yaw = 0) {
  if (S.state === "crash") {
    fall(dt);
    return;
  }
  FALL.on = false;
  riderG.rotation.set(0, 0, 0);
  riderG.position.set(0, 0, 0);
  riderRoot.position.set(board.position.x, 0, board.position.z);
  riderRoot.rotation.y = yaw;
  riderRoot.updateMatrixWorld(true);
  const tg = riderTargets(), a = 1 - Math.exp(-tg.k * dt);
  POSE.H += (tg.H - POSE.H) * a;
  POSE.arm += (tg.arm - POSE.arm) * a;
  POSE.lean += (tg.lean - POSE.lean) * a;

  backShoe.localToWorld(J.ankB.set(0, 0.075, 0));
  frontShoe.localToWorld(J.ankF.set(0, 0.075, 0));
  riderRoot.worldToLocal(J.ankB);
  riderRoot.worldToLocal(J.ankF);
  J.hip.set((J.ankB.x + J.ankF.x) / 2 + 0.02, Math.max(J.ankB.y, J.ankF.y) + POSE.H, -0.03);
  // keep both ankles reachable: drop the hips if a leg would have to over-stretch
  for (const [ank, sx] of [[J.ankB, -0.1], [J.ankF, 0.1]] as const) {
    const dx = J.hip.x + sx - ank.x, dz = J.hip.z - ank.z, reach = (L1 + L2) * 0.985;
    const maxY = ank.y + Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz));
    J.hip.y = Math.min(J.hip.y, maxY);
  }
  J.hipB.copy(J.hip).x -= 0.1;
  J.hipF.copy(J.hip).x += 0.1;
  solveKnee(J.hipB, J.ankB, _v.set(-0.35, 0.1, 1), J.kneeB);
  solveKnee(J.hipF, J.ankF, _v.set(0.35, 0.1, 1), J.kneeF);
  const lean = POSE.lean;
  J.chest.copy(J.hip).add(_v.set(0.04, 0.5 * Math.cos(lean), 0.5 * Math.sin(lean)));
  J.shB.copy(J.chest).add(_v.set(-0.17, -0.04, 0));
  J.shF.copy(J.chest).add(_v.set(0.17, -0.04, 0));
  const am = POSE.arm;
  // front arm reaches toward the nose, back arm toward the tail; both open up for balance
  J.elbF.copy(J.shF).add(_v.set(Math.sin(am) * 0.28, -Math.cos(am) * 0.28, 0.06));
  J.handF.copy(J.elbF).add(_v.set(Math.sin(am + 0.45) * 0.26, -Math.cos(am + 0.45) * 0.26, 0.08));
  J.elbB.copy(J.shB).add(_v.set(-Math.sin(am * 0.85) * 0.28, -Math.cos(am * 0.85) * 0.28, 0.08));
  J.handB.copy(J.elbB).add(_v.set(-Math.sin(am * 0.85 + 0.4) * 0.26, -Math.cos(am * 0.85 + 0.4) * 0.26, 0.1));
  J.neck.copy(J.chest).add(_v.set(0.02, 0.1, 0.03));
  J.head.copy(J.chest).add(_v.set(0.05, 0.27, 0.06));
  drawRider();
  FALL.pivot.set((J.ankB.x + J.ankF.x) / 2, 0.08, 0);
  for (const k of JOINTS) FALL.snap[k].copy(J[k]);
}

function drawRider() {
  place(RIG.thighB, J.hipB, J.kneeB);
  place(RIG.shinB, J.kneeB, J.ankB);
  place(RIG.thighF, J.hipF, J.kneeF);
  place(RIG.shinF, J.kneeF, J.ankF);
  RIG.kneeB.position.copy(J.kneeB);
  RIG.kneeF.position.copy(J.kneeF);
  RIG.pelvis.position.copy(J.hip);
  placeTorso(J.hip, J.chest);
  place(RIG.uArmB, J.shB, J.elbB);
  place(RIG.fArmB, J.elbB, J.handB);
  place(RIG.uArmF, J.shF, J.elbF);
  place(RIG.fArmF, J.elbF, J.handF);
  RIG.elbB.position.copy(J.elbB);
  RIG.elbF.position.copy(J.elbF);
  RIG.handB.position.copy(J.handB);
  RIG.handF.position.copy(J.handF);
  place(RIG.neck, J.chest, J.neck);
  RIG.head.position.copy(J.head);
}

/** the board stopped; the rider's momentum carries on and they topple forward onto the ground */
function fall(dt: number) {
  if (!FALL.on) {
    FALL.on = true;
    FALL.t = 0;
  }
  FALL.t += dt;
  const e = Math.min(1, FALL.t / 0.55);
  riderG.position.set(FALL.pivot.x + 0.9 * e, FALL.pivot.y - 0.02 * e, 0);
  riderG.rotation.z = -1.42 * e * e;
  // joints are kept relative to the pivot (ankles) so the whole body rotates about the feet
  for (const k of JOINTS) J[k].copy(FALL.snap[k]).sub(FALL.pivot);
  drawRider();
}
