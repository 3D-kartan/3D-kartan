/**
 * Enhanced zoom utilities for Cesium Viewer.
 *
 * Key improvements:
 *  - Adaptive zoom step: the farther the camera is from the ground,
 *    the larger the zoom step becomes (percentage-based).
 *  - Prevents zooming below a minimum height (minHeight).
 *  - Supports both instant zoom (camera.zoomIn/zoomOut) and smooth
 *    animated zoom (flyZoomIn).
 *
 * Usage:
 *   import { zoomIn, zoomOut, goHome, flyZoomIn } from "./zoom-in-out-home";
 */

/**
 * Computes an adaptive zoom step based on current camera height.
 *
 * @param {Number} height  Current camera height in meters
 * @param {Object} opts    { scale, minStep, maxStep, minHeight }
 * @returns {Number}       A positive zoom step in meters
 *
 * Logic:
 *  - step = height * scale (percentage-based)
 *  - step is clamped between minStep and maxStep
 *  - step is also clamped so we never go below minHeight
 */
function computeStep(
  height,
  { scale = 0.2, minStep = 50, maxStep = 1e6, minHeight = 250 } = {}
) {
  // Base step: proportional to height
  const desired = Math.max(minStep, height * scale);

  // Upper clamp
  const capped = Math.min(maxStep, desired);

  // Prevent zooming below minHeight
  const allowed = Math.max(0, height - minHeight);

  return Math.min(capped, allowed);
}

/**
 * Adaptive instant zoom-in.
 * Uses camera.zoomIn(step) for immediate movement (no animation).
 *
 * @param {Viewer} viewer
 * @param {Object} opts { scale, minStep, minHeight, maxStep }
 */
export function zoomIn(viewer, opts = {}) {
  const camera = viewer.camera;
  const ellipsoid = viewer.scene.globe.ellipsoid;

  const carto = ellipsoid.cartesianToCartographic(camera.position);
  const height = carto.height;

  const { minHeight = 250 } = opts;

  // Prevent zooming below minHeight
  if (height <= minHeight) return;

  const step = computeStep(height, { ...opts, minHeight });
  if (step <= 0) return;

  camera.zoomIn(step);
}

/**
 * Adaptive instant zoom-out.
 * Uses camera.zoomOut(step) for immediate movement.
 *
 * @param {Viewer} viewer
 * @param {Object} opts { scale, minStep, maxStep }
 */
export function zoomOut(viewer, opts = {}) {
  const camera = viewer.camera;
  const ellipsoid = viewer.scene.globe.ellipsoid;

  const carto = ellipsoid.cartesianToCartographic(camera.position);
  const height = carto.height;

  // Step grows with height, but is clamped
  const step = Math.min(
    opts.maxStep ?? 1e6,
    Math.max(opts.minStep ?? 50, height * (opts.scale ?? 0.2))
  );

  camera.zoomOut(step);
}

/**
 * Smoothly flies the camera back to Cesium's default home position.
 *
 * @param {Viewer} viewer
 * @param {Number} duration Animation duration in seconds
 */
export function goHome(viewer, duration = 1.5) {
  viewer.camera.flyHome(duration);
}

/**
 * Smooth animated zoom-in.
 *
 * Instead of using camera.zoomIn(), this function:
 *  - Computes a new target height
 *  - Converts it to Cartesian3
 *  - Uses camera.flyTo() for a smooth animation
 *
 * This gives a more polished UX for UI buttons.
 *
 * @param {Viewer} viewer
 * @param {Object} opts { scale, minStep, minHeight, maxStep, duration }
 */
export function flyZoomIn(viewer, opts = {}) {
  const camera = viewer.camera;
  const scene = viewer.scene;
  const ellipsoid = scene.globe.ellipsoid;

  const carto = ellipsoid.cartesianToCartographic(camera.position);
  const height = carto.height;

  const {
    scale = 0.2,
    minStep = 50,
    minHeight = 10,
    maxStep = 1e6,
    duration = 0.6
  } = opts;

  // Prevent zooming below minHeight
  if (height <= minHeight) return;

  const step = computeStep(height, { scale, minStep, maxStep, minHeight });
  if (step <= 0) return;

  // Compute new height, clamped to minHeight
  const newHeight = Math.max(minHeight, height - step);

  // Keep same lat/lon, only adjust height
  const destCarto = {
    longitude: carto.longitude,
    latitude: carto.latitude,
    height: newHeight
  };

  const destination = ellipsoid.cartographicToCartesian(destCarto);

  // Smooth animated zoom
  camera.flyTo({
    destination,
    duration
  });
}

/**
 * Optional default export if you want a bundled API:
 *
 * export default {
 *   zoomIn,
 *   zoomOut,
 *   flyZoomIn,
 *   goHome
 * };
 */
