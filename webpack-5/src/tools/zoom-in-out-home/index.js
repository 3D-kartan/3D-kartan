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

import { Matrix4, Cartesian3 } from "cesium";
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
function isTransformedCamera(camera) {
  return !Matrix4.equals(camera.transform, Matrix4.IDENTITY);
}

function getCameraWorldHeight(viewer) {
  const camera = viewer.camera;
  const ellipsoid = viewer.scene.globe.ellipsoid;

  // positionWC = world coordinates, works even if the camera has a transform
  const carto =
    camera.positionCartographic ??
    ellipsoid.cartesianToCartographic(camera.positionWC);

  return carto?.height ?? 0;
}

function getLockedCameraRange(viewer) {
  // When lookAtTransform is used, camera.position is a local offset from the target
  return Cartesian3.magnitude(viewer.camera.position);
}

function setLockedCameraRange(viewer, newRange) {
  const camera = viewer.camera;

  const currentOffset = camera.position;
  const currentRange = Cartesian3.magnitude(currentOffset);

  if (!Number.isFinite(currentRange) || currentRange <= 0.001) return false;
  if (!Number.isFinite(newRange) || newRange <= 0.001) return false;

  const scale = newRange / currentRange;

  const newOffset = Cartesian3.multiplyByScalar(
    currentOffset,
    scale,
    new Cartesian3()
  );

  // Keep the same target + same direction, only change the distance
  camera.lookAtTransform(camera.transform, newOffset);
  viewer.scene.requestRender?.();

  return true;
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

  // LOCKED CAMERA MODE:
  // Zoom by decreasing the distance to the target/pin
  if (isTransformedCamera(camera)) {
    const range = getLockedCameraRange(viewer);
    const minRange = opts.minRange ?? opts.minHeight ?? 250;

    if (range <= minRange) return;

    const step = computeStep(range, {
      ...opts,
      minHeight: minRange
    });

    if (step <= 0) return;

    const newRange = Math.max(minRange, range - step);
    setLockedCameraRange(viewer, newRange);
    return;
  }

  // NORMAL MODE:
  const height = getCameraWorldHeight(viewer);
  const { minHeight = 250 } = opts;

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

  // LOCKED CAMERA MODE:
  // Zoom by increasing the distance to the target/pin
  if (isTransformedCamera(camera)) {
    const range = getLockedCameraRange(viewer);

    const step = Math.min(
      opts.maxStep ?? 1e6,
      Math.max(opts.minStep ?? 50, range * (opts.scale ?? 0.2))
    );

    const newRange = range + step;
    setLockedCameraRange(viewer, newRange);
    return;
  }

  // NORMAL MODE:
  const height = getCameraWorldHeight(viewer);

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
export async function goHome(viewer, duration = 1.5, opts = {}) {
  const { closeProjectFirst = true } = opts;

  // Cancel any ongoing camera flight first
  viewer.camera.cancelFlight?.();

  if (closeProjectFirst) {
    const closeFn = viewer?.__projectMenuApi?.closeProjectSidebar;

    if (typeof closeFn === "function") {
      await Promise.resolve(closeFn());
    }
  }

  viewer.camera.flyHome(duration);
}

