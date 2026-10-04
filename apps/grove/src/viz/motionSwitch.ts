// One switch for the whole grove motion layer (viz/groveMotion.ts): the idle
// movement, the depth shading and the change animations.
//
// To go back to the plain grove, build with VITE_GROVE_MOTION=0, or delete
// groveMotion.ts and its three call sites in GroveCanvas.tsx. With the switch
// off, the canvas is exactly what renderGrove draws.
let enabled = import.meta.env.VITE_GROVE_MOTION !== '0';

export function groveMotionEnabled(): boolean {
  return enabled;
}

/** For tests, and for trying the plain grove without rebuilding. */
export function setGroveMotion(on: boolean): void {
  enabled = on;
}
