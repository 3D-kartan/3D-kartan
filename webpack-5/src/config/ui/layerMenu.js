// src/ui/layerMenu.js

import {
  OpenStreetMapImageryProvider,
  WebMapServiceImageryProvider,
  Cesium3DTileset,
  Cesium3DTileStyle,
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
 *  - Maximum of 3 group levels
 *  - CSS hooks for different header colors per group level
 *
 * @param {Viewer} viewer - Cesium Viewer instance
 * @param {object} config - Layer configuration object
 */
export default function initLayerMenu(viewer, config) {
  // ------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------
  const MAX_GROUP_LEVELS = 3;

  // ------------------------------------------------------------
  // DOM references
  // ------------------------------------------------------------
  const menu = document.getElementById("layerMenu");
  const btnOpen = document.getElementById("layerMenuButton");
  btnOpen.style.setProperty("--icon", "var(--black-icon-layers)");
  const btnClose = document.getElementById("layerMenuClose");
  const bgContainer = document.getElementById("backgroundButtons");
  const groupContainer = document.getElementById("tilesetGroups");
  const footer = document.getElementById("layerMenuFooter");

  // ------------------------------------------------------------
  // State containers
  // ------------------------------------------------------------
  let currentBgLayer = null;

  // Loaded layer instances
  const loadedTilesets = {}; // name -> Cesium3DTileset
  const loadedWMSImagery = {}; // name -> ImageryLayer

  // Tracks tilesets currently loading to avoid duplicate loads
  const loadingTilesets = {}; // name -> Promise<Cesium3DTileset | null>

  // Tracks the desired visibility state of each layer
  // This makes async loading safer if the user toggles quickly
  const layerVisibilityState = {}; // name -> boolean

  // Search entries
  const tilesetEntries = [];

  // Stores each group's sync function so a whole subtree can be re-synced after bulk operations
  const groupSyncMap = new WeakMap();

  const tilesetClipMgr = config.tilesetClipMgr;

  // ------------------------------------------------------------
  // Validation helpers
  // ------------------------------------------------------------
  /**
   * Validates that the group hierarchy does not exceed MAX_GROUP_LEVELS.
   *
   * level = 1 means root group level
   */
  function validateGroupDepth(groups, level = 1, path = []) {
    if (!Array.isArray(groups)) return;

    groups.forEach((group) => {
      const label = group.title || group.name || "Unnamed group";
      const nextPath = [...path, label];

      if (level > MAX_GROUP_LEVELS) {
        throw new Error(
          `Max ${MAX_GROUP_LEVELS} group levels are allowed. Too deep group path: ${nextPath.join(
            " > "
          )}`
        );
      }

      validateGroupDepth(group.groups, level + 1, nextPath);
    });
  }

  // ------------------------------------------------------------
  // Helper: load a tileset (Ion or URL)
  // ------------------------------------------------------------
  function loadTileset(layer) {
    if (layer.ionAssetId) {
      return Cesium3DTileset.fromIonAssetId(
        layer.ionAssetId,
        layer.options || {}
      );
    }

    return Cesium3DTileset.fromUrl(layer.url, layer.options || {});
  }

  // ------------------------------------------------------------
  // Generic UI / state helpers
  // ------------------------------------------------------------
  /**
   * Sets a checkbox state and emits a bubbling change event.
   * This is important because subgroup sync depends on event bubbling.
   */
  function setCheckboxState(checkbox, checked) {
    if (!checkbox || checkbox.checked === checked) return;
    checkbox.checked = checked;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Reads the current opacity slider value from a layer item.
   */
  function getOpacityFromItem(item) {
    const slider = item?.querySelector('input[type="range"]');
    return slider ? parseFloat(slider.value) : 1;
  }

  /**
   * Applies opacity to a 3D tileset using Cesium style color alpha.
   */
  function applyTilesetOpacity(tsObj, opacity) {
    tsObj.style = new Cesium3DTileStyle({
      color: `color('white', ${opacity})`,
    });
  }

  /**
   * Applies common performance settings to 3D tilesets.
   */
  function applyTilesetPerformanceSettings(tsObj) {
    tsObj.dynamicScreenSpaceError = true;
    tsObj.dynamicScreenSpaceErrorDensity = 0.002;
    tsObj.dynamicScreenSpaceErrorFactor = 4.0;
  }

  /**
   * Re-syncs all nested group checkboxes in a subtree from the bottom up.
   * Bottom-up is important so child groups are resolved before parent groups.
   */
  function syncGroupSubtree(rootEl) {
    const groups = Array.from(rootEl.querySelectorAll(".group")).reverse();

    groups.forEach((groupNode) => {
      const syncFn = groupSyncMap.get(groupNode);
      if (typeof syncFn === "function") {
        syncFn();
      }
    });
  }

  // ------------------------------------------------------------
  // Layer activation helpers
  // ------------------------------------------------------------
  /**
   * Enables a layer and returns the created/loaded Cesium object.
   * - WMS  -> ImageryLayer
   * - 3D   -> Cesium3DTileset
   *
   * The helper is shared by:
   *  - checkbox change
   *  - visible-at-start autoload
   *  - group toggles
   *  - zoom button
   *  - search results
   */
  function enableLayer(layer, item) {
    const isWMS = layer.type === "WMS";
    const opacity = getOpacityFromItem(item);

    layerVisibilityState[layer.name] = true;

    if (isWMS) {
      let imgLayer = loadedWMSImagery[layer.name];

      // Reuse existing WMS layer if already loaded
      if (!imgLayer) {
        const provider = new WebMapServiceImageryProvider({
          url: layer.url,
          layers: layer.layers,
          parameters: layer.parameters || {},
        });

        imgLayer = viewer.imageryLayers.addImageryProvider(provider);
        loadedWMSImagery[layer.name] = imgLayer;
      }

      imgLayer.alpha = opacity;
      item?.classList.add("active");

      return Promise.resolve(imgLayer);
    }

    // Reuse existing tileset if already loaded
    if (loadedTilesets[layer.name]) {
      const tsObj = loadedTilesets[layer.name];
      applyTilesetOpacity(tsObj, opacity);
      item?.classList.add("active");
      return Promise.resolve(tsObj);
    }

    // If already loading, return the same promise
    if (loadingTilesets[layer.name]) {
      return loadingTilesets[layer.name].then((tsObj) => {
        if (!tsObj) return null;

        // Re-apply opacity in case the slider changed while loading
        applyTilesetOpacity(tsObj, getOpacityFromItem(item));

        if (layerVisibilityState[layer.name]) {
          item?.classList.add("active");
        }

        return tsObj;
      });
    }

    // Start loading the tileset
    loadingTilesets[layer.name] = loadTileset(layer)
      .then((tsObj) => {
        // If the layer was turned off while loading, do not add it
        if (layerVisibilityState[layer.name] !== true) {
          return null;
        }

        viewer.scene.primitives.add(tsObj);
        applyTilesetPerformanceSettings(tsObj);
        applyTilesetOpacity(tsObj, opacity);

        loadedTilesets[layer.name] = tsObj;
        tilesetClipMgr?.registerTileset(tsObj);
        item?.classList.add("active");

        return tsObj;
      })
      .finally(() => {
        delete loadingTilesets[layer.name];
      });

    return loadingTilesets[layer.name];
  }

  /**
   * Disables a layer and removes it from Cesium if currently loaded.
   */
  function disableLayer(layer, item) {
    const isWMS = layer.type === "WMS";

    layerVisibilityState[layer.name] = false;

    if (isWMS) {
      const imgLayer = loadedWMSImagery[layer.name];
      if (imgLayer) {
        viewer.imageryLayers.remove(imgLayer, true);
        delete loadedWMSImagery[layer.name];
      }

      item?.classList.remove("active");
      return;
    }

    const tsObj = loadedTilesets[layer.name];
    if (tsObj) {
      viewer.scene.primitives.remove(tsObj);
      tilesetClipMgr?.unregisterTileset(tsObj);
      delete loadedTilesets[layer.name];
    }

    item?.classList.remove("active");
  }

  // ------------------------------------------------------------
  // 1) Open/close layer menu
  // ------------------------------------------------------------
  btnOpen.addEventListener("click", () => menu.classList.toggle("open"));
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
        url: layer.url,
        layers: layer.layers,
        parameters: layer.parameters || {},
      });
    }

    console.warn("Unknown background type:", layer.type);
    return null;
  }

  // Render background layer buttons
  config.backgroundLayers.forEach((layer) => {
    const btn = document.createElement("button");
    btn.className = "icon-button";
    btn.title = layer.name;

    const imgFile = config.stylesMap[layer.style];
    if (imgFile) {
      btn.style.backgroundImage = `url(images/icons/${imgFile})`;
    }

    bgContainer.appendChild(btn);

    btn.addEventListener("click", () => {
      if (currentBgLayer) {
        viewer.imageryLayers.remove(currentBgLayer, true);
      }

      const provider = createImageryProvider(layer);
      if (!provider) return;

      currentBgLayer = viewer.imageryLayers.addImageryProvider(provider);

      // Always keep the background at the bottom
      viewer.imageryLayers.lowerToBottom(currentBgLayer);

      // Highlight active background
      Array.from(bgContainer.children).forEach((b) =>
        b.classList.remove("active")
      );
      btn.classList.add("active");
    });

    // Auto-select the primary background
    if (layer.primary) {
      btn.click();
    }
  });

  // ------------------------------------------------------------
  // 3) Group tilesets and WMS layers by group name
  // ------------------------------------------------------------
  const tilesByGroup = {};

  (config.tilesets || []).forEach((ts) => {
    if (!tilesByGroup[ts.group]) tilesByGroup[ts.group] = [];
    tilesByGroup[ts.group].push(ts);
  });

  (config.wmsLayers || []).forEach((wms) => {
    if (!tilesByGroup[wms.group]) tilesByGroup[wms.group] = [];
    tilesByGroup[wms.group].push(wms);
  });

  // ------------------------------------------------------------
  // 4) Recursive group renderer
  // ------------------------------------------------------------
  function renderGroups(parentEl, groups, depth = 0) {
    const level = depth + 1;

    // Extra guard, even though we validate before rendering
    if (level > MAX_GROUP_LEVELS) {
      console.warn(
        `Skipping unsupported group level ${level}. Max allowed is ${MAX_GROUP_LEVELS}.`
      );
      return;
    }

    groups.forEach((group) => {
      // Group container
      const groupEl = document.createElement("div");
      groupEl.className = "group";
      groupEl.dataset.level = String(level);

      // Header row
      const header = document.createElement("div");
      header.className = "group-header";
      header.classList.add(`group-header-level-${level}`);
      groupEl.appendChild(header);
       header.addEventListener("click", (ev) => {
        if (ev.target !== groupCheckbox) {
          header.classList.toggle("open");
        }
      });

      // Optional group checkbox (only for nested groups)
      let groupCheckbox = null;
      if (depth > 0) {
        groupCheckbox = document.createElement("input");
        groupCheckbox.type = "checkbox";
        groupCheckbox.className = "group-checkbox";
        groupCheckbox.title = "Tänd/släck alla lager i denna grupp";
        header.appendChild(groupCheckbox);
      }

      // Group title
      const titleSpan = document.createElement("span");
      titleSpan.className = "group-label";
      titleSpan.textContent = group.title;
      header.appendChild(titleSpan);

      // Content container for subgroups + layers
      const content = document.createElement("div");
      content.className = "group-content";
      groupEl.appendChild(content);

      // Prevent repeated sync while toggling many descendant layers at once
      let bulkToggleInProgress = false;

      // Expand/collapse when clicking the header
      // Do not toggle if the click came directly from the group checkbox
      header.addEventListener("click", (ev) => {
        if (ev.target !== groupCheckbox) {
          content.classList.toggle("open");
        }
      });

      /**
       * Synchronizes the group checkbox state based on all descendant layer checkboxes.
       *
       * States:
       * - checked       => all descendants are checked
       * - unchecked     => none are checked
       * - indeterminate => some are checked
       */
      function syncGroupCheckbox() {
        if (!groupCheckbox) return;

        const childCbs = content.querySelectorAll(".tileset-checkbox");

        if (!childCbs.length) {
          groupCheckbox.checked = false;
          groupCheckbox.indeterminate = false;
          return;
        }

        const checkedCount = Array.from(childCbs).filter(
          (cb) => cb.checked
        ).length;

        groupCheckbox.checked = checkedCount === childCbs.length;
        groupCheckbox.indeterminate =
          checkedCount > 0 && checkedCount < childCbs.length;
      }

      // Register sync function so parent bulk operations can re-sync this subtree
      groupSyncMap.set(groupEl, syncGroupCheckbox);

      // Group checkbox toggles all descendant layers as one bulk operation
      if (groupCheckbox) {
        groupCheckbox.addEventListener("change", () => {
          const targetChecked = groupCheckbox.checked;

          // Suppress repeated sync while descendant layers are being toggled
          bulkToggleInProgress = true;

          try {
            content.querySelectorAll(".tileset-checkbox").forEach((cb) => {
              setCheckboxState(cb, targetChecked);
            });
          } finally {
            bulkToggleInProgress = false;
          }

          // Re-sync all nested subgroup checkboxes bottom-up
          syncGroupSubtree(content);

          // Re-sync this group itself last
          syncGroupCheckbox();

          // Notify ancestors once after the whole bulk operation is complete
          groupEl.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }

      // Any descendant layer checkbox change should update this group
      content.addEventListener("change", (ev) => {
        if (bulkToggleInProgress) return;

        if (ev.target?.classList?.contains("tileset-checkbox")) {
          syncGroupCheckbox();

          // Bubble a group change upward so parent groups can also update
          groupEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });

      // When subgroups emit a change, re-sync this group
      groupEl.addEventListener("change", () => {
        if (bulkToggleInProgress) return;
        syncGroupCheckbox();
      });

      // Render nested groups recursively
      if (Array.isArray(group.groups)) {
        renderGroups(content, group.groups, depth + 1);
      }

      // Render layers that belong directly to this group
      const list = tilesByGroup[group.name] || [];

      list.forEach((layer) => {
        const isWMS = layer.type === "WMS";

        // Layer item container
        const item = document.createElement("div");
        item.className = "tileset-item";

        // Row with checkbox + icon/button + label + info
        const row = document.createElement("div");
        row.className = "tileset-row";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "tileset-checkbox";
        row.appendChild(checkbox);

        // WMS uses an icon, 3D tiles use a zoom button
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
          zoomButton.title = "Zooma till lager";
          row.appendChild(zoomButton);
        }

        // Layer label
        const label = document.createElement("label");
        label.textContent = layer.title || layer.name;
        row.appendChild(label);

        // Info button
        const moreButton = document.createElement("button");
        moreButton.className = "more-button";
        moreButton.title = "Visa mer info";
        row.appendChild(moreButton);

        item.appendChild(row);

        // Hidden info panel
        const infoPanel = document.createElement("div");
        infoPanel.className = "info-panel";
        infoPanel.style.display = "none";

        const infoTextEl = document.createElement("p");
        infoTextEl.textContent =
          layer.infoText || "Ingen information tillgänglig";

        const sliderLabel = document.createElement("label");
        sliderLabel.textContent = "Opacitet:";

        const opacitySlider = document.createElement("input");
        opacitySlider.type = "range";
        opacitySlider.min = 0;
        opacitySlider.max = 1;
        opacitySlider.step = 0.01;
        opacitySlider.value = 1;

        infoPanel.append(infoTextEl, sliderLabel, opacitySlider);
        item.appendChild(infoPanel);

        // Toggle info panel
        moreButton.addEventListener("click", (ev) => {
          ev.stopPropagation();
          infoPanel.style.display =
            infoPanel.style.display === "none" ? "block" : "none";
        });

        // Update opacity live if the layer is already loaded
        opacitySlider.addEventListener("input", () => {
          const opacity = parseFloat(opacitySlider.value);

          if (isWMS) {
            const imgLayer = loadedWMSImagery[layer.name];
            if (imgLayer) {
              imgLayer.alpha = opacity;
            }
          } else {
            const tsObj = loadedTilesets[layer.name];
            if (tsObj) {
              applyTilesetOpacity(tsObj, opacity);
            }
          }
        });

        // Checkbox is the single source of truth for on/off state
        checkbox.addEventListener("change", async () => {
          try {
            if (checkbox.checked) {
              await enableLayer(layer, item);
            } else {
              disableLayer(layer, item);
            }
          } catch (err) {
            console.error(`Could not load layer "${layer.name}"`, err);

            // Revert the checkbox if enabling failed
            if (checkbox.checked) {
              setCheckboxState(checkbox, false);
            } else {
              item.classList.remove("active");
            }
          }
        });

        // Zoom-to-layer button for 3D tilesets
        if (zoomButton) {
          zoomButton.addEventListener("click", async (ev) => {
            ev.stopPropagation();

            try {
              // Turn on via the checkbox flow so subgroup sync stays correct
              if (!checkbox.checked) {
                setCheckboxState(checkbox, true);
              }

              const tsObj = await enableLayer(layer, item);
              if (tsObj) {
                await viewer.zoomTo(tsObj);
              }
            } catch (err) {
              console.error(`Could not zoom to layer "${layer.name}"`, err);
              setCheckboxState(checkbox, false);
            }
          });
        }

        // Register entry for search
        tilesetEntries.push({
          layer,
          name: layer.name,
          title: layer.title,
          nameLower: (layer.title || layer.name).toLowerCase(),
          isWMS,
          checkbox,
          item,
        });

        content.appendChild(item);
      });

      // IMPORTANT:
      // We intentionally DO NOT auto-check the whole group here.
      // That old behavior caused nested subgroup layers to turn on incorrectly
      // even when "visible-at-start" was false on those layers.

      // Final sync after nested groups + direct layers are rendered
      syncGroupCheckbox();

      parentEl.appendChild(groupEl);
    });
  }

  // ------------------------------------------------------------
  // Render all groups
  // ------------------------------------------------------------
  try {
    validateGroupDepth(config.groups || []);
  } catch (err) {
    console.error(err);
    return;
  }

  renderGroups(groupContainer, config.groups || []);

  // ------------------------------------------------------------
  // Autoload layers with "visible-at-start": true
  // ------------------------------------------------------------
  // This is now the ONLY place that decides which layers should be on at startup.
  config.tilesets?.forEach((layer) => {
    if (layer["visible-at-start"]) {
      const entry = tilesetEntries.find((e) => e.name === layer.name);
      if (!entry) return;

      setCheckboxState(entry.checkbox, true);
    }
  });

  config.wmsLayers?.forEach((layer) => {
    if (layer["visible-at-start"]) {
      const entry = tilesetEntries.find((e) => e.name === layer.name);
      if (!entry) return;

      setCheckboxState(entry.checkbox, true);
    }
  });

  // ------------------------------------------------------------
  // Search UI
  // ------------------------------------------------------------
  const searchContainer = document.createElement("div");
  searchContainer.className = "tileset-search";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
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
      .filter((e) => e.nameLower.includes(q))
      .forEach((e) => {
        const hit = document.createElement("div");
        hit.className = "search-result";
        hit.textContent = e.title || e.name;

        hit.addEventListener("click", async () => {
          searchInput.value = "";
          results.innerHTML = "";

          try {
            // Always go through checkbox flow so subgroup state stays in sync
            if (!e.checkbox.checked) {
              setCheckboxState(e.checkbox, true);
            }

            if (e.isWMS) {
              await enableLayer(e.layer, e.item);
            } else {
              const tsObj = await enableLayer(e.layer, e.item);
              if (tsObj) {
                await viewer.zoomTo(tsObj);
              }
            }
          } catch (err) {
            console.error(
              `Could not activate layer "${e.name}" from search`,
              err
            );
            setCheckboxState(e.checkbox, false);
          }
        });

        results.appendChild(hit);
      });
  });
}