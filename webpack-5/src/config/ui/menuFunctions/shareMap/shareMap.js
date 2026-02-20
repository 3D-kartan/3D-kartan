// ui/menuFunctions/shareMap/shareMap.js

// Only the Cesium parts we need:
import { Cartesian3, Math as CesiumMath } from "cesium";

/**
 * Creates a shareable URL based on the viewer's current camera position.
 *
 * What it does:
 *  - Reads camera longitude, latitude, height, heading, pitch, roll
 *  - Encodes them as URL parameters
 *  - Copies the generated link to clipboard
 *  - Updates the browser URL without adding a new history entry
 *
 * @param {Viewer} viewer - Cesium Viewer instance
 */
export function shareView(viewer) {
  const cam    = viewer.camera;
  const carto  = cam.positionCartographic;

  // Extract camera parameters in degrees
  const lon    = CesiumMath.toDegrees(carto.longitude);
  const lat    = CesiumMath.toDegrees(carto.latitude);
  const height = carto.height;
  const hdg    = CesiumMath.toDegrees(cam.heading);
  const pitch  = CesiumMath.toDegrees(cam.pitch);
  const roll   = CesiumMath.toDegrees(cam.roll);

  // Base URL (origin + path, no query params)
  const base   = window.location.origin + window.location.pathname;

  // Build query string
  const params = new URLSearchParams({ lon, lat, height, hdg, pitch, roll });
  const url    = `${base}?${params.toString()}`;

  // Copy to clipboard and notify user
  copyToClipboard(url)
    .then(() => alert("Länk kopierad:\n" + url))
    .catch(() => alert("Kunde inte kopiera länken"));

  // Update browser URL without creating a new history entry
  window.history.replaceState({}, document.title, url);
}

/**
 * Reads camera parameters from the URL and moves the camera accordingly.
 *
 * This allows:
 *  - Sharing a link with a specific camera view
 *  - Opening the map with the same view someone else shared
 *
 * @param {Viewer} viewer - Cesium Viewer instance
 */
export function applyUrlCamera(viewer) {
  const p       = new URLSearchParams(window.location.search);

  // Parse all parameters
  const lon     = parseFloat(p.get("lon"));
  const lat     = parseFloat(p.get("lat"));
  const height  = parseFloat(p.get("height"));
  const hdg     = parseFloat(p.get("hdg"));
  const pitch   = parseFloat(p.get("pitch"));
  const roll    = parseFloat(p.get("roll"));

  // Only apply if all values are valid numbers
  if ([lon, lat, height, hdg, pitch, roll].every(v => !isNaN(v))) {
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(lon, lat, height),
      orientation: {
        heading: CesiumMath.toRadians(hdg),
        pitch:   CesiumMath.toRadians(pitch),
        roll:    CesiumMath.toRadians(roll),
      },
    });
  }
}

/**
 * Copies text to clipboard.
 * Uses the modern Clipboard API if available,
 * otherwise falls back to a hidden <textarea> trick.
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
function copyToClipboard(text) {
  // Modern API
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  // Fallback for older browsers
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left     = "-9999px";
    document.body.appendChild(ta);

    ta.select();
    const ok = document.execCommand("copy");

    document.body.removeChild(ta);
    ok ? resolve() : reject();
  });
}
