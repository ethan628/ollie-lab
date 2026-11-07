// Lower-left virtual joystick: drag the knob within the ring; it springs back to the centre on release.
// x: −1 (left) … 1 (right); y: −1 (pulled down) … 1 (pushed up). Works with touch, pen and mouse.
export const joy = { x: 0, y: 0, active: false };

export function mountJoystick(el: HTMLElement) {
  const knob = el.querySelector<HTMLElement>(".knob")!;
  let id: number | null = null;
  const radius = () => el.clientWidth / 2 - knob.clientWidth / 4;

  function move(e: PointerEvent) {
    const r = el.getBoundingClientRect(), max = radius();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > max) (dx *= max / d), (dy *= max / d);
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // a small dead zone so a resting thumb doesn't drift
    const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    joy.x = dead(dx / max);
    joy.y = dead(-dy / max);
  }
  function release(e: PointerEvent) {
    if (e.pointerId !== id) return;
    id = null;
    joy.x = joy.y = 0;
    joy.active = false;
    el.classList.remove("on");
    knob.style.transform = "translate(-50%, -50%)";
  }
  el.addEventListener("pointerdown", (e) => {
    if (id !== null) return;
    id = e.pointerId;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone: still track it until pointerup */
    }
    joy.active = true;
    el.classList.add("on");
    move(e);
    e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => e.pointerId === id && move(e));
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("lostpointercapture", release);
}
