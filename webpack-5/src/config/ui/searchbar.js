// src/ui/searchbar.js

import {
  Cartesian3,
  Cartesian2,
  Cartographic,
  Math as CesiumMath,
  sampleTerrainMostDetailed,
  Color,
  HorizontalOrigin
} from "cesium";

/**
 * Initializes the address search bar if config.searchbar[0].active === true.
 *
 * Features:
 *  - Builds a centered search UI with a clear icon and dropdown
 *  - Performs dynamic API lookups as the user types
 *  - Displays suggestions in a dropdown
 *  - Flies the camera to the selected address
 *  - Places a temporary point + label at the selected location
 *
 * @param {Viewer} viewer - Cesium Viewer instance
 * @param {Object} config - Loaded index.json configuration
 */
export function initSearchBar(viewer, config) {
  const sbCfg = config.searchbar?.[0];
  if (!sbCfg || !sbCfg.active) {
    return;
  }

  // ------------------------------------------------------------
  // BUILD UI
  // A centered search bar with a clear icon and dropdown container
  // ------------------------------------------------------------
  const container = document.createElement("div");
  container.id = "searchBarContainer";

  Object.assign(container.style, {
    position:   "absolute",
    top:        "10px",
    left:       "50%",
    transform:  "translateX(-50%)",
    zIndex:     "2000",
    display:    "flex",
    alignItems: "center"
  });

  container.innerHTML = `
    <div id="searchInputWrapper" style="position:relative; width:250px;">
      <input
        id="addressSearchInput"
        type="text"
        placeholder="Sök adress..."
        autocomplete="off"
        aria-label="Sök adress"
      />
      <button
        id="searchClearIcon"
        class="search-clear-inside"
        aria-label="Rensa sökning"
        title="Rensa"
      ></button>
      <div id="addressDropdown"></div>
    </div>
  `;

  document.body.appendChild(container);

  const inputEl     = document.getElementById("addressSearchInput");
  const clearIconEl = document.getElementById("searchClearIcon");
  const dropdownEl  = document.getElementById("addressDropdown");

  let tempPoint;

  // ------------------------------------------------------------
  // Helper: Populate dropdown with clickable address suggestions
  // ------------------------------------------------------------
  function populateDropdown(list) {
    dropdownEl.innerHTML = "";

    list.forEach(item => {
      const el = document.createElement("div");
      el.className = "addressItem";
      el.style.padding = "4px 8px";
      el.style.cursor  = "pointer";
      el.textContent   = `${item.td_adress}, ${item.td_kommund}`;

      el.addEventListener("click", () => {
        flyToAddress(item);
        dropdownEl.style.display = "none";
      });

      dropdownEl.appendChild(el);
    });

    dropdownEl.style.display = list.length ? "block" : "none";
  }

  // ------------------------------------------------------------
  // Fly camera to selected address + place temporary marker
  // ------------------------------------------------------------
  function flyToAddress(addr) {
    const [lon, lat] = addr.json_geometry.coordinates;
    const carto = Cartographic.fromDegrees(lon, lat);

    sampleTerrainMostDetailed(viewer.terrainProvider, [carto])
      .then(samples => {
        const pos = samples[0];

        // Smooth camera flight
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(lon, lat, pos.height + 200),
          duration: 2
        });

        // Remove previous temp point
        if (tempPoint) {
          viewer.entities.remove(tempPoint);
        }

        // Add new temporary point + label
        tempPoint = viewer.entities.add({
          position: Cartesian3.fromDegrees(lon, lat, pos.height + 10),
          point: {
            pixelSize:    10,
            color:        Color.RED,
            outlineColor: Color.WHITE,
            outlineWidth: 2
          },
          label: {
            text:            `${addr.td_adress}, ${addr.td_kommund}`,
            showBackground:  true,
            backgroundColor: Color.BLACK,
            fillColor:       Color.WHITE,
            horizontalOrigin: HorizontalOrigin.CENTER,
            verticalOrigin:   HorizontalOrigin.BOTTOM,
            pixelOffset:      new Cartesian2(0, -15)
          }
        });

        // Auto-remove after 10 seconds
        setTimeout(() => viewer.entities.remove(tempPoint), 10000);
      })
      .catch(err => console.error("Terrain sampling failed:", err));
  }

  // ------------------------------------------------------------
  // Dynamic API search as user types
  // ------------------------------------------------------------
  inputEl.addEventListener("input", () => {
    const q = inputEl.value.trim();

    // Show/hide clear icon
    if (q) {
      clearIconEl.style.display = "inline-block";
      clearIconEl.style.setProperty("--icon", "var(--black-icon-close)");
      clearIconEl.style.backgroundImage = "var(--icon)";
    } else {
      clearIconEl.style.display = "none";
      dropdownEl.style.display = "none";
    }

    if (!q) return;

    // Fetch suggestions from your API
    fetch(`https://3dkartan.vdmb.se/api/adresser?q=${encodeURIComponent(q)}`)
      .then(res => res.json())
      .then(geojson => {
        if (!geojson.features) {
          dropdownEl.style.display = "none";
          return;
        }

        // Convert GeoJSON → internal format
        const suggestions = geojson.features.map(f => ({
          td_adress:     f.properties.td_adress,
          td_kommund:  f.properties.td_kommund,
          json_geometry: f.geometry
        }));

        populateDropdown(suggestions);
      })
      .catch(err => {
        console.error("API‐sökning misslyckades:", err);
        dropdownEl.style.display = "none";
      });
  });

  // ------------------------------------------------------------
  // Clear search input
  // ------------------------------------------------------------
  clearIconEl.addEventListener("click", () => {
    inputEl.value = "";
    clearIconEl.style.display = "none";
    dropdownEl.style.display = "none";
    inputEl.focus();
  });

  // ------------------------------------------------------------
  // Close dropdown when clicking outside
  // ------------------------------------------------------------
  document.addEventListener("click", evt => {
    if (
      !dropdownEl.contains(evt.target) &&
      evt.target !== inputEl &&
      evt.target !== clearIconEl
    ) {
      dropdownEl.style.display = "none";
    }
  });
}
