// src/tools/bookmarks/index.js

/**
 * Bookmarks tool for Cesium Viewer.
 *
 * Purpose:
 *  - Provides a simple UI panel listing predefined camera locations.
 *  - Each bookmark represents a named geographic position (lng/lat/height).
 *  - Clicking a bookmark smoothly flies the camera to that location.
 *
 * Key behaviors:
 *  - Reads bookmark definitions from the tool's config object.
 *  - Enforces a maximum of 10 bookmarks; additional entries are ignored.
 *  - Validates each bookmark before rendering a button.
 *  - Uses Cesium's camera.flyTo() for smooth navigation.
 *
 * Usage:
 *   initBookmarks(panelElement, viewerInstance, toolConfigFromJSON);
 *
 * Expected config shape:
 * {
 *   toolName: "bookmarks",
 *   locations: [
 *     { name: "Tumba", position: { lng: 17.833, lat: 59.198, height: 750 } },
 *     { name: "Tullinge", position: { lng: 17.886, lat: 59.200, height: 750 } }
 *   ]
 * }
 */

import { Cartesian3, Math } from "cesium";
import "./style.css";

/**
 * Initializes the Bookmarks tool inside a floating panel.
 *
 * @param {HTMLElement} panel      The container element for the tool UI.
 * @param {Viewer}      viewer     The Cesium Viewer instance.
 * @param {Object}      toolConfig The configuration object for this tool.
 *
 * Behavior:
 *  - Builds the panel UI (header, instructions, bookmark list).
 *  - Extracts up to 10 bookmark entries from toolConfig.locations.
 *  - Creates one button per valid bookmark.
 *  - Clicking a button triggers a camera.flyTo() animation.
 */
export default function initBookmarks(panel, viewer, toolConfig = {}) {
  // Panel header
  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = "Bokmärken";
  panel.appendChild(header);

  // Panel body
  const body = document.createElement("div");
  body.className = "panel-body";
  panel.appendChild(body);

  // Instruction text
  const instructions = document.createElement("div");
  instructions.className = "tool-instructions";
  instructions.textContent = "Klicka på ett bokmärke för att zooma till området.";
  body.appendChild(instructions);

  /**
   * Extract and limit bookmark entries.
   * Only the first 10 entries are used to avoid UI overflow.
   */
  const locations = Array.isArray(toolConfig.locations) ? toolConfig.locations : [];
  const limitedLocations = locations.slice(0, 10);

  // No bookmarks available
  if (!limitedLocations.length) {
    const empty = document.createElement("div");
    empty.className = "tool-empty";
    empty.textContent = "Inga bokmärken konfigurerade.";
    body.appendChild(empty);
    return;
  }

  // Container for bookmark buttons
  const list = document.createElement("div");
  list.className = "bookmark-list";
  body.appendChild(list);

  /**
   * Render each bookmark as a button.
   * Each button validates its coordinates before enabling navigation.
   */
  limitedLocations.forEach((loc) => {
    const name = loc?.name ?? "Okänt namn";
    const pos = loc?.position;

    const lng = pos?.lng;
    const lat = pos?.lat;
    const height = pos?.height ?? 750;

    const valid =
      typeof lng === "number" &&
      typeof lat === "number" &&
      typeof height === "number";

    // Create button
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bookmark-item";
    btn.textContent = name;
    btn.disabled = !valid;

    /**
     * Smooth camera navigation.
     * Uses Cartesian3.fromDegrees() to convert WGS84 coordinates.
     */
    btn.addEventListener("click", () => {
      if (!valid) return;

      const destination = Cartesian3.fromDegrees(lng, lat, height);
        // Optional orientation (in degrees)
      const ori = loc?.orientation || {};
      viewer.camera.flyTo({
        destination,
        duration: 1.2,
        orientation: {
        heading: Math.toRadians(ori.heading ?? 0),
        pitch: Math.toRadians(ori.pitch ?? -90),
        roll: Math.toRadians(ori.roll ?? 0)
        }
    });
    });

    list.appendChild(btn);
  });
}
