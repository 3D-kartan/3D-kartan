// src/ui/layerMenu.js

import {
  OpenStreetMapImageryProvider,
  WebMapServiceImageryProvider,
  Cesium3DTileset,
  Cesium3DTileStyle
} from "cesium";

/**
 * Initializes the layer menu UI.
 *
 * Features:
 *  - Background layer switching (OSM / WMS)
 *  - Hierarchical group structure for tilesets and WMS layers
 *  - Lazy loading of 3D tilesets and WMS imagery
 *  - Per-layer opacity control
 *  - Zoom-to-layer functionality
 *  - Info panels for metadata
 *  - Group-level toggles (turn all layers on/off)
 *  - Search bar for quick layer lookup
 *  - Autoload of layers with "visible-at-start": true
 *
 * @param {Viewer} viewer - Cesium Viewer instance
 * @param {object} config - Layer configuration object
 */
export default function initLayerMenu(viewer, config) {

  // ------------------------------------------------------------
  // DOM references
  // ------------------------------------------------------------
  const menu           = document.getElementById("layerMenu");
  const btnOpen        = document.getElementById("layerMenuButton");
  btnOpen.style.setProperty("--icon", "var(--black-icon-layers)");
  const btnClose       = document.getElementById("layerMenuClose");
  const bgContainer    = document.getElementById("backgroundButtons");
  const groupContainer = document.getElementById("tilesetGroups");
  const footer         = document.getElementById("layerMenuFooter");

  // State containers
  let currentBgLayer = null;
  const loadedTilesets   = {};   // name → Cesium3DTileset instance
  const loadedWMSImagery = {};   // name → ImageryLayer instance
  const tilesetEntries   = [];   // used for search

  // ------------------------------------------------------------
  // Helper: load a tileset (Ion or URL)
  // ------------------------------------------------------------
  function loadTileset(layer) {
    if (layer.ionAssetId) {
      return Cesium3DTileset.fromIonAssetId(layer.ionAssetId, layer.options || {});
    } else {
      return Cesium3DTileset.fromUrl(layer.url, layer.options || {});
    }
  }

  // ------------------------------------------------------------
  // 1) Open/close layer menu
  // ------------------------------------------------------------
  btnOpen.addEventListener("click",  () => menu.classList.toggle("open"));
  btnClose.addEventListener("click", () => menu.classList.remove("open"));

  // ------------------------------------------------------------
  // 2) Background layers (OSM / WMS)
  // ------------------------------------------------------------
  function createImageryProvider(layer) {
    if (layer.type === "OSM") {
      return new OpenStreetMapImageryProvider();
    }
    if (layer.type === "WMS") {
      return new WebMapServiceImageryProvider({
        url:        layer.url,
        layers:     layer.layers,
        parameters: layer.parameters || {}
      });
    }
    console.warn("Unknown background type:", layer.type);
    return null;
  }

  // Render background layer buttons
  config.backgroundLayers.forEach(layer => {
    const btn = document.createElement("button");
    btn.className = "icon-button";
    btn.title     = layer.name;

    const imgFile = config.stylesMap[layer.style];
    if (imgFile) btn.style.backgroundImage = `url(images/icons/${imgFile})`;

    bgContainer.appendChild(btn);

    btn.addEventListener("click", () => {
      if (currentBgLayer) {
        viewer.imageryLayers.remove(currentBgLayer, true);
      }
      const provider = createImageryProvider(layer);
      if (!provider) return;

      currentBgLayer = viewer.imageryLayers.addImageryProvider(provider);

      // Highlight active background
      Array.from(bgContainer.children).forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });

    // Auto-select primary background
    if (layer.primary) {
      btn.click();
    }
  });

  // ------------------------------------------------------------
  // 3) Group tilesets and WMS layers by group name
  // ------------------------------------------------------------
  const tilesByGroup = {};

  (config.tilesets || []).forEach(ts => {
    if (!tilesByGroup[ts.group]) tilesByGroup[ts.group] = [];
    tilesByGroup[ts.group].push(ts);
  });

  (config.wmsLayers || []).forEach(wms => {
    if (!tilesByGroup[wms.group]) tilesByGroup[wms.group] = [];
    tilesByGroup[wms.group].push(wms);
  });

  // ------------------------------------------------------------
  // 4) Recursive group renderer
  // ------------------------------------------------------------
  function renderGroups(parentEl, groups, depth = 0) {
    groups.forEach(group => {

      // Group container
      const groupEl = document.createElement("div");
      groupEl.className = "group";

      // Header row
      const header = document.createElement("div");
      header.className = "group-header";
      groupEl.appendChild(header);

      // Optional group checkbox (only for nested groups)
      let groupCheckbox = null;
      if (depth > 0) {
        groupCheckbox = document.createElement("input");
        groupCheckbox.type      = "checkbox";
        groupCheckbox.className = "group-checkbox";
        groupCheckbox.title     = "Tänd/släck alla lager i denna grupp";
        header.appendChild(groupCheckbox);
      }

      // Group title
      const titleSpan = document.createElement("span");
      titleSpan.className = "group-label";
      titleSpan.textContent = group.title;
      header.appendChild(titleSpan);

      // Content container (subgroups + layers)
      const content = document.createElement("div");
      content.className = "group-content";
      groupEl.appendChild(content);

      // Expand/collapse behavior
      header.addEventListener("click", ev => {
        if (ev.target !== groupCheckbox) {
          content.classList.toggle("open");
        }
      });

      // Group checkbox toggles all child layers
      if (groupCheckbox) {
        groupCheckbox.addEventListener("change", () => {
          content.querySelectorAll(".tileset-checkbox").forEach(cb => {
            if (cb.checked !== groupCheckbox.checked) {
              cb.checked = groupCheckbox.checked;
              cb.dispatchEvent(new Event("change"));
            }
          });
        });
      }

      // Render nested groups recursively
      if (Array.isArray(group.groups)) {
        renderGroups(content, group.groups, depth + 1);
      }

      // Render layers belonging to this group
      const list = tilesByGroup[group.name] || [];

      list.forEach(layer => {
        const isWMS = layer.type === "WMS";

        // Layer item container
        const item = document.createElement("div");
        item.className = "tileset-item";

        // Row with checkbox + icon + label + info button
        const row = document.createElement("div");
        row.className = "tileset-row";

        const checkbox = document.createElement("input");
        checkbox.type      = "checkbox";
        checkbox.className = "tileset-checkbox";
        row.appendChild(checkbox);

        // Icon or zoom button
        let zoomButton = null;
        if (isWMS) {
          const icon = document.createElement("div");
          icon.className = "wms-icon";
          const imgFile = config.stylesMap[layer.style];
          icon.style.backgroundImage = imgFile
            ? `url(images/icons/${imgFile})`
            : "var(--black-icon-map)";
          row.appendChild(icon);
        } else {
          zoomButton = document.createElement("button");
          zoomButton.className = "zoom-button";
          zoomButton.title     = "Zooma till lager";
          row.appendChild(zoomButton);
        }

        // Layer label
        const label = document.createElement("label");
        label.textContent = layer.title || layer.name;
        row.appendChild(label);

        // Info button
        const moreButton = document.createElement("button");
        moreButton.className = "more-button";
        moreButton.title     = "Visa mer info";
        row.appendChild(moreButton);

        item.appendChild(row);

        // Info panel (hidden by default)
        const infoPanel = document.createElement("div");
        infoPanel.className     = "info-panel";
        infoPanel.style.display = "none";

        const infoTextEl = document.createElement("p");
        infoTextEl.textContent = layer.infoText || "Ingen information tillgänglig";

        const sliderLabel = document.createElement("label");
        sliderLabel.textContent = "Opacitet:";

        const opacitySlider = document.createElement("input");
        opacitySlider.type  = "range";
        opacitySlider.min   = 0;
        opacitySlider.max   = 1;
        opacitySlider.step  = 0.01;
        opacitySlider.value = 1;

        infoPanel.append(infoTextEl, sliderLabel, opacitySlider);
        item.appendChild(infoPanel);

        // Toggle info panel
        moreButton.addEventListener("click", ev => {
          ev.stopPropagation();
          infoPanel.style.display =
            infoPanel.style.display === "none" ? "block" : "none";
        });

        // Opacity slider logic
        opacitySlider.addEventListener("input", () => {
          const v = parseFloat(opacitySlider.value);

          if (isWMS) {
            const imgL = loadedWMSImagery[layer.name];
            if (imgL) imgL.alpha = v;
          } else {
            const ts = loadedTilesets[layer.name];
            if (ts) ts.style = new Cesium3DTileStyle({
              color: `color('white', ${v})`
            });
          }
        });

        // Checkbox toggles layer on/off
        checkbox.addEventListener("change", () => {
          const opacity = parseFloat(opacitySlider.value);

          if (isWMS) {
            if (checkbox.checked) {
              const provider = new WebMapServiceImageryProvider({
                url:        layer.url,
                layers:     layer.layers,
                parameters: layer.parameters || {}
              });
              const imgLayer = viewer.imageryLayers.addImageryProvider(provider);
              imgLayer.alpha = opacity;
              loadedWMSImagery[layer.name] = imgLayer;
              item.classList.add("active");
            } else {
              const imgLayer = loadedWMSImagery[layer.name];
              if (imgLayer) {
                viewer.imageryLayers.remove(imgLayer, true);
                delete loadedWMSImagery[layer.name];
                item.classList.remove("active");
              }
            }
          } else {
            if (checkbox.checked) {
              loadTileset(layer)
                .then(tsObj => {
                  viewer.scene.primitives.add(tsObj);

                  // ADD THIS HERE 
                  tsObj.dynamicScreenSpaceError = true; 
                  tsObj.dynamicScreenSpaceErrorDensity = 0.002; 
                  tsObj.dynamicScreenSpaceErrorFactor = 4.0;

                  tsObj.style = new Cesium3DTileStyle({
                    color: `color('white', ${opacity})`
                  });
                  loadedTilesets[layer.name] = tsObj;
                  item.classList.add("active");
                })
                .catch(() => { checkbox.checked = false; });
            } else {
              const tsObj = loadedTilesets[layer.name];
              if (tsObj) {
                viewer.scene.primitives.remove(tsObj);
                delete loadedTilesets[layer.name];
                item.classList.remove("active");
              }
            }
          }
        });

        // Zoom-to-layer button
        if (zoomButton) {
          zoomButton.addEventListener("click", ev => {
            ev.stopPropagation();

            if (!checkbox.checked) {
              checkbox.checked = true;

              loadTileset(layer)
                .then(tsObj => {
                  viewer.scene.primitives.add(tsObj);

                  tsObj.dynamicScreenSpaceError = true; 
                  tsObj.dynamicScreenSpaceErrorDensity = 0.002; 
                  tsObj.dynamicScreenSpaceErrorFactor = 4.0;

                  const slider = item.querySelector("input[type=range]");
                  const opacity = parseFloat(slider.value);

                  tsObj.style = new Cesium3DTileStyle({
                    color: `color('white', ${opacity})`
                  });

                  loadedTilesets[layer.name] = tsObj;
                  item.classList.add("active");

                  return viewer.zoomTo(tsObj);
                })
                .catch(() => { checkbox.checked = false; });
            } else {
              viewer.zoomTo(loadedTilesets[layer.name]);
            }
          });
        }

        // Register entry for search
        tilesetEntries.push({
          name:       layer.name,
          nameLower: (layer.title || layer.name).toLowerCase(),
          isWMS,
          checkbox,
          url:        layer.url,
          ionAssetId: layer.ionAssetId,
          options:    layer.options,
          layers:     layer.layers,
          parameters: layer.parameters,
          title:      layer.title
        });

        content.appendChild(item);
      });

      // Auto-check group checkbox if all layers have visible-at-start
      if (groupCheckbox) {
        const allVisibleAtStart =
          list.length > 0 && list.every(layer => layer["visible-at-start"] === true);

        if (allVisibleAtStart) {
          groupCheckbox.checked = true;

          content.querySelectorAll(".tileset-checkbox").forEach(cb => {
            if (!cb.checked) {
              cb.checked = true;
              cb.dispatchEvent(new Event("change"));
            }
          });
        }
      }

      parentEl.appendChild(groupEl);
    });
  }

  // Render all groups
  renderGroups(groupContainer, config.groups || []);

  // ------------------------------------------------------------
  // Autoload layers with "visible-at-start": true
  // ------------------------------------------------------------
  config.tilesets?.forEach(layer => {
    if (layer["visible-at-start"]) {
      const entry = tilesetEntries.find(e => e.name === layer.name);
      if (!entry) return;

      const checkbox = entry.checkbox;
      if (!checkbox.checked) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change"));
      }
    }
  });

  config.wmsLayers?.forEach(layer => {
    if (layer["visible-at-start"]) {
      const entry = tilesetEntries.find(e => e.name === layer.name);
      if (!entry) return;

      const checkbox = entry.checkbox;
      if (!checkbox.checked) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change"));
      }
    }
  });

  // ------------------------------------------------------------
  // Search UI
  // ------------------------------------------------------------
  const searchContainer = document.createElement("div");
  searchContainer.className = "tileset-search";

  const searchInput = document.createElement("input");
  searchInput.type        = "text";
  searchInput.placeholder = "Sök lager...";

  const results = document.createElement("div");
  results.className = "search-results";

  searchContainer.append(searchInput, results);
  groupContainer.parentNode.insertBefore(searchContainer, footer);

  // Search logic
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    results.innerHTML = "";
    if (!q) return;

    tilesetEntries
      .filter(e => e.nameLower.includes(q))
      .forEach(e => {
        const hit = document.createElement("div");
        hit.className   = "search-result";
        hit.textContent = e.title || e.name;

        hit.addEventListener("click", () => {
          searchInput.value = "";
          results.innerHTML = "";

          // If layer is off, turn it on
          if (!e.checkbox.checked) {
            e.checkbox.checked = true;

            if (e.isWMS) {
              e.checkbox.dispatchEvent(new Event("change"));
              const imgLayer = loadedWMSImagery[e.name];
              if (imgLayer) {
                const item   = e.checkbox.closest(".tileset-item");
                const slider = item.querySelector("input[type=range]");
                imgLayer.alpha = parseFloat(slider.value);
              }
            } else {
              loadTileset(e)
                .then(tsObj => {
                  viewer.scene.primitives.add(tsObj);

                  const item   = e.checkbox.closest(".tileset-item");
                  const slider = item.querySelector("input[type=range]");
                  const opacity = parseFloat(slider.value);

                  tsObj.style = new Cesium3DTileStyle({
                    color: `color('white', ${opacity})`
                  });

                  loadedTilesets[e.name] = tsObj;
                  return viewer.zoomTo(tsObj);
                })
                .catch(() => { e.checkbox.checked = false; });
            }
          } else if (!e.isWMS) {
            // If already on, zoom to it
            viewer.zoomTo(loadedTilesets[e.name]);
          }
        });

        results.appendChild(hit);
      });
  });
}
