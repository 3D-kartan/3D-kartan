// src/ui/menuFunctions/coordinates.js

import proj4 from "proj4";
import {
  Cartesian2,
  Cartographic,
  Math as CesiumMath,
  sampleTerrainMostDetailed
} from "cesium";
import "./coordinates.css";

/**
 * Initializes a live coordinate display that updates as the user moves
 * the mouse over the Cesium globe.
 *
 * Features:
 *  - Converts WGS84 coordinates to any target CRS using proj4
 *  - Samples terrain height for accurate elevation values
 *  - Displays coordinates in a floating div inside the Cesium container
 *  - Automatically disables on mobile devices
 *  - Returns a teardown function that removes both the UI and event listeners
 *
 * @param {Viewer} viewer        - The Cesium Viewer instance
 * @param {Array} defsArray      - Array of CRS definitions: [{ code, alias, projection }]
 * @param {string} [containerId] - ID of the Cesium container element
 * @returns {Function}           - A teardown callback that removes the feature
 */
export function initCoordinates(viewer, defsArray, containerId = "cesiumContainer") {
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);

  // Do not enable coordinate display on mobile devices
  if (isMobile) return () => {};

  // ------------------------------------------------------------
  // 1) Register all proj4 CRS definitions
  // ------------------------------------------------------------
  defsArray.forEach(d => {
    proj4.defs(d.code, d.projection);
    if (d.alias) proj4.defs(d.alias, d.projection);
  });

  // ------------------------------------------------------------
  // 2) Create coordinate display div if it doesn't exist
  // ------------------------------------------------------------
  const root = document.getElementById(containerId);
  if (!root) {
    console.error(`Hittade ingen container med id="${containerId}"`);
    return () => {};
  }

  let coordDiv = document.getElementById("coordinates");
  if (!coordDiv) {
    coordDiv = document.createElement("div");
    coordDiv.id = "coordinates";
    root.appendChild(coordDiv);
  }

  // ------------------------------------------------------------
  // 3) Mousemove listener: update coordinates in real time
  // ------------------------------------------------------------
  const handler = e => {
    // Convert screen position → globe position
    const ray       = viewer.camera.getPickRay(new Cartesian2(e.clientX, e.clientY));
    const cartesian = viewer.scene.globe.pick(ray, viewer.scene);

    // If cursor is not over terrain, clear display
    if (!cartesian) {
      coordDiv.textContent = "";
      return;
    }

    // Sample terrain height for accurate elevation
    sampleTerrainMostDetailed(viewer.terrainProvider, [cartesian])
      .then(updated => {
        const pos   = updated[0];
        const carto = Cartographic.fromCartesian(pos);

        const lon = CesiumMath.toDegrees(carto.longitude);
        const lat = CesiumMath.toDegrees(carto.latitude);

        // Convert from source CRS → target CRS
        // defsArray[0] = source CRS (usually EPSG:4326)
        // defsArray[1] = target CRS (e.g. SWEREF99 TM)
        const target = proj4(defsArray[0].code, defsArray[1].code, [lon, lat]);

        coordDiv.textContent =
          `E: ${target[0].toFixed(3)}, N: ${target[1].toFixed(3)}, H: ${carto.height.toFixed(2)} m`;
      })
      .catch(err => {
        console.error("Sampling failed:", err);
        coordDiv.textContent = "";
      });
  };

  // Attach listener to the Cesium canvas
  viewer.scene.canvas.addEventListener("mousemove", handler);

  // ------------------------------------------------------------
  // 4) Return teardown function
  // Removes both the event listener and the coordinate div
  // ------------------------------------------------------------
  return () => {
    viewer.scene.canvas.removeEventListener("mousemove", handler);
    const div = document.getElementById("coordinates");
    if (div) div.remove();
  };
}
