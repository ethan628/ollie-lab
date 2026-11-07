// Which world to build: the straight practice course (default) or the open skatepark (?mode=park, or
// #park where only the hash reaches the page, as on a claude.ai artifact link).
// Headless tests can set globalThis.__OLLIE_MODE before importing the physics.
export type Mode = "course" | "park";

const forced = (globalThis as { __OLLIE_MODE?: Mode }).__OLLIE_MODE;
const fromUrl =
  typeof location !== "undefined" && (new URLSearchParams(location.search).get("mode") === "park" || location.hash === "#park");

export const MODE: Mode = forced ?? (fromUrl ? "park" : "course");
export const PARK = MODE === "park";
