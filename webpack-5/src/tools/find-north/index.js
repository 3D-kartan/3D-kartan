// src/tools/find-north/index.js
import { Cartesian3, Math as CesiumMath } from "cesium";

/**
 * Initializes the "Rotate North" / "Find North" button.
 * The button both:
 *  1) Rotates its icon in real time to match the camera heading
 *  2) Reorients the camera to face true north when clicked
 *
 * @param {HTMLButtonElement} btn - The button element controlling the feature
 * @param {Viewer} viewer - The Cesium Viewer instance
 */
export default function initFindNorth(btn, viewer) {
  /**
   * Updates the button icon rotation based on the camera heading.
   * This keeps the UI compass aligned with the current camera orientation.
   */
  const updateIcon = () => {
    let headingDeg = CesiumMath.toDegrees(viewer.camera.heading);

    // Normalize negative headings (e.g., -0.01 → 359.99)
    if (headingDeg < 0) headingDeg += 360;

    // Round for a stable, non-jittery compass display
    headingDeg = Math.round(headingDeg * 10) / 10;

    // Snap to exact north when very close (prevents micro-rotations)
    if (Math.abs(headingDeg) < 0.5 || Math.abs(headingDeg - 360) < 0.5) {
      headingDeg = 0;
    }

    // Apply rotation to the icon using a CSS variable
    btn.style.setProperty("--icon-rotation", `${-headingDeg}deg`);
  };

  // Initial sync and continuous updates when the camera moves
  updateIcon();
  viewer.camera.changed.addEventListener(updateIcon);

  /**
   * On click: smoothly rotate the camera to face true north.
   * The camera position is preserved; only the heading is adjusted.
   */
  btn.addEventListener("click", () => {
    const cam = viewer.camera;
    const carto = cam.positionCartographic;

    // Keep the same geographic position and altitude
    const dest = Cartesian3.fromRadians(
      carto.longitude,
      carto.latitude,
      carto.height
    );

    cam.flyTo({
      destination: dest,
      orientation: {
        heading: 0,          // Face north
        pitch: cam.pitch,    // Preserve pitch
        roll: cam.roll       // Preserve roll
      },
      complete: () => {
        // After the flight, snap to exact north to avoid floating‑point drift
        cam.setView({
          destination: dest,
          orientation: {
            heading: CesiumMath.toRadians(0),
            pitch: cam.pitch,
            roll: cam.roll
          }
        });
      }
    });
  });
}
