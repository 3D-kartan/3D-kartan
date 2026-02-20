// src/ui/rightClickMenu.js

import proj4 from "proj4";
import {
  Cartesian2,
  Cartographic,
  Math as CesiumMath,
  sampleTerrainMostDetailed,
  VerticalOrigin,
  HeightReference
} from "cesium";

/**
 * Initializes a right‑click context menu that allows the user to copy
 * coordinates in multiple coordinate systems (CRS).
 *
 * Features:
 *  - Right‑click anywhere on the Cesium globe to open a menu
 *  - Shows coordinates in all configured CRS (proj4Defs)
 *  - Automatically samples terrain height for accurate Z values
 *  - Places a temporary pin at the clicked location
 *  - Clicking a menu item copies the coordinate string to clipboard
 *  - Menu auto‑closes when clicking outside or when camera moves
 *
 * @param {Viewer} viewer - Cesium Viewer instance
 * @param {Array} proj4Defs - Array of CRS definitions from config
 * @param {string} containerId - DOM element ID for Cesium container
 */
export function initCopyCoordinates(viewer, proj4Defs, containerId = "cesiumContainer") {
  // Only run on desktop devices
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  if (isMobile) return () => {};

  // Validate proj4 definitions
  if (!Array.isArray(proj4Defs) || proj4Defs.length === 0) {
    console.warn("initCopyCoordinates: proj4Defs saknas eller är inte en array");
    return () => {};
  }

  // Register proj4 CRS definitions
  proj4Defs.forEach(def => {
    proj4.defs(def.code, def.projection);
    if (def.alias) proj4.defs(def.alias, def.projection);
  });

  const container = document.getElementById(containerId);
  if (!container) {
    console.error("copyCoordinates: kunde inte hitta container", containerId);
    return () => {};
  }

  // ------------------------------------------------------------
  // Build context menu UI
  // ------------------------------------------------------------
  const menu = document.createElement("div");
  menu.id = "coordCopyMenu";
  menu.className = "coord-copy-menu hidden";
  document.body.appendChild(menu);

  const header = document.createElement("div");
  header.className = "coord-copy-header";
  header.textContent = "Kopiera koordinater";
  menu.appendChild(header);

  const list = document.createElement("div");
  list.className = "coord-copy-list";
  menu.appendChild(list);

  // Toast notification for successful copy
  const toast = document.createElement("div");
  toast.id = "coordCopyToast";
  toast.className = "coord-copy-toast hidden";
  toast.textContent = "Koordinater kopierade!";
  document.body.appendChild(toast);

  function showToast() {
    toast.classList.remove("hidden");
    toast.classList.add("visible");
    setTimeout(() => {
      toast.classList.remove("visible");
      toast.classList.add("hidden");
    }, 2000);
  }

  let lastCartesian = null;
  let tempPin = null;

  // ------------------------------------------------------------
  // Right‑click handler: show menu + place temporary pin
  // ------------------------------------------------------------
  container.addEventListener("contextmenu", async evt => {
    evt.preventDefault();

    // Convert screen click to globe position
    const ray = viewer.camera.getPickRay(new Cartesian2(evt.clientX, evt.clientY));
    const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
    if (!cartesian) return;

    lastCartesian = cartesian;

    // Remove previous temporary pin
    if (tempPin) {
      viewer.entities.remove(tempPin);
      tempPin = null;
    }

    // Add new temporary pin at clicked location
    tempPin = viewer.entities.add({
      position: cartesian,
      billboard: {
        image: "./images/icons/Orange_pin.png",
        scale: 0.05,
        verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.CLAMP_TO_GROUND
      }
    });

    // Sample terrain height for accurate Z value
    const updated = await sampleTerrainMostDetailed(viewer.terrainProvider, [cartesian]);
    const carto = Cartographic.fromCartesian(updated[0]);

    const lon = CesiumMath.toDegrees(carto.longitude);
    const lat = CesiumMath.toDegrees(carto.latitude);

    // Clear previous CRS list
    list.innerHTML = "";

    // Build list of coordinate formats
    proj4Defs.forEach(def => {
      const label = def.label || def.code;

      let text;
      if (def.code === "EPSG:4326") {
        // WGS84: show Lat/Lon
        text = `${label}: Lat ${lat.toFixed(6)}, Lon ${lon.toFixed(6)}, Z ${carto.height.toFixed(2)}`;
      } else {
        // Convert to target CRS
        const [E, N] = proj4(proj4Defs[0].code, def.code, [lon, lat]);
        text = `${label}: E ${E.toFixed(3)}, N ${N.toFixed(3)}, Z ${carto.height.toFixed(2)}`;
      }

      const item = document.createElement("div");
      item.className = "coord-copy-item";
      item.textContent = text;
      item.dataset.copy = text;

      list.appendChild(item);
    });

    // Show menu at cursor position
    menu.classList.remove("hidden");
    menu.style.left = evt.clientX + "px";
    menu.style.top  = evt.clientY + "px";

    // Adjust menu if it goes outside viewport
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth  = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (menuRect.right > viewportWidth) {
      menu.style.left = (evt.clientX - menuRect.width) + "px";
    }
    if (menuRect.bottom > viewportHeight) {
      menu.style.top = (evt.clientY - menuRect.height) + "px";
    }
  });

  // ------------------------------------------------------------
  // Clicking a menu item copies the coordinate string
  // ------------------------------------------------------------
  menu.addEventListener("click", async evt => {
    const item = evt.target.closest(".coord-copy-item");
    if (!item) return;

    const text = item.dataset.copy;

    try {
      await navigator.clipboard.writeText(text);
      showToast();
    } catch (err) {
      console.error("Kunde inte kopiera:", err);
    }

    menu.classList.add("hidden");

    // Remove temporary pin
    if (tempPin) {
      viewer.entities.remove(tempPin);
      tempPin = null;
    }
  });

  // ------------------------------------------------------------
  // Clicking outside the menu closes it
  // ------------------------------------------------------------
  document.addEventListener("click", evt => {
    if (!menu.contains(evt.target)) {
      menu.classList.add("hidden");

      if (tempPin) {
        viewer.entities.remove(tempPin);
        tempPin = null;
      }
    }
  });

  // ------------------------------------------------------------
  // Camera movement closes menu + removes pin
  // ------------------------------------------------------------
  viewer.camera.changed.addEventListener(() => {
    if (!menu.classList.contains("hidden")) {
      menu.classList.add("hidden");

      if (tempPin) {
        viewer.entities.remove(tempPin);
        tempPin = null;
      }
    }
  });

  // Cleanup function returned to caller
  return () => {
    menu.remove();
    toast.remove();
  };
}
