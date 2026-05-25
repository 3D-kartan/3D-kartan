// src/ui/projectMenu.js
import {
  OpenStreetMapImageryProvider,
  WebMapServiceImageryProvider,
  Cesium3DTileset,
  Cesium3DTileStyle,
  UrlTemplateImageryProvider,
  SingleTileImageryProvider,
  WebMapTileServiceImageryProvider,
  Cartesian3,
  Rectangle,
  VerticalOrigin,
  Ellipsoid,
  ScreenSpaceEventHandler,
  DistanceDisplayCondition,
  HeightReference,
  Color,
  LabelStyle,
  Cartesian2,
  ScreenSpaceEventType,
  Math as CesiumMath,
  ClippingPolygon,
  ClippingPolygonCollection,
  Matrix4,
  Transforms,
  HeadingPitchRange
} from "cesium";

import {
  projectHasClippingSpec,
  getClippingMaxPoints,
  resolveClippingPositionsFromProject,
  flattenLonLatPairs
} from "./clippingSpecResolver.js";

export default function initProjectMenuUI(viewer, config = {}) {
  let terrainClipReqId = 0;
  let cameraFocusReqId = 0;

  let projectSessionId = 0;

function invalidateProjectSession() {
  projectSessionId++;
  return projectSessionId;
}

function isProjectSessionActive(sessionId, projectIndex) {
  return (
    sessionId === projectSessionId &&
    currentProjectIndex === projectIndex &&
    sidebar.style.display !== "none" &&
    sidebar.dataset.projectIndex === String(projectIndex)
  );
}

function unloadProjectLayers(projectIndex) {
  if (projectIndex == null) return;

  const project = projects[projectIndex];
  if (!project || !Array.isArray(project.content)) return;

  project.content.forEach((layer) => {
    const isWMS =
      layer.type === "WMS" ||
      (layer.provider && String(layer.provider).toUpperCase() === "WMS");

    if (isWMS) {
      const img = loadedWMSImagery[layer.name];
      if (img) {
        viewer.imageryLayers.remove(img, true);
        delete loadedWMSImagery[layer.name];
      }
    } else {
      const ts = loadedTilesets[layer.name];
      if (ts) {
        viewer.scene.primitives.remove(ts);
        delete loadedTilesets[layer.name];
      }
    }
  });
}

  // Backup guard against multiple initializations on the same viewer instance
  if (viewer.__projectMenuApi) {
    console.warn("[projectMenu] already initialized; returning existing API");
    return viewer.__projectMenuApi;
  }
  const projects = Array.isArray(config.projects) ? config.projects : [];
  const tilesetClipMgr = config.tilesetClipMgr;
  let tilesetClippingEnabled = false;
  if (projects.length === 0) {
    console.warn("Inga projekt hittades i configen - projektmenyn initieras inte.");
    return {};
  }
function hasOwn(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key);
}
function isBoolean(v) {
  return typeof v === "boolean";
}
function hasTerrainClippingSpec(project) {
  return projectHasClippingSpec(project, "terrain");
}

function hasTilesetClippingSpec(project) {
  return projectHasClippingSpec(project, "tileset");
}
function terrainClipFeatureEnabledByConfig(project) {
  return (
    hasTerrainClippingSpec(project) &&
    isBoolean(project?.["terrain-enableAtStart"]) &&
    isBoolean(project?.["inverse-terrain"])
  );
}

function tilesetClipFeatureEnabledByConfig(project) {
  return (
    hasTilesetClippingSpec(project) &&
    isBoolean(project?.["tileset-enableAtStart"]) &&
    isBoolean(project?.["inverse-tilesets"])
  );
}
function shouldShowTerrainClipRow(project) {
  return terrainClipFeatureEnabledByConfig(project);
}

function shouldShowTilesetClipRow(project) {
  return tilesetClipFeatureEnabledByConfig(project);
}
  // --- Utilities ---
  function debounce(fn, wait = 120) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // --- DOM setup ---
  const wrapper = document.createElement("div");
  wrapper.id = "bottomLeftMenu";
  document.body.appendChild(wrapper);

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "tool-button";
  toggleBtn.title = "Pågående Projekt";
  toggleBtn.style.setProperty("--icon", "var(--black-icon-construction)");
  wrapper.appendChild(toggleBtn);

  const menuBox = document.createElement("div");
  menuBox.id = "projectMenuBox";
  menuBox.style.display = "none";
  wrapper.appendChild(menuBox);

  const closeBtn = document.createElement("button");
  closeBtn.className = "tool-button";
  closeBtn.title = "Stäng";
  closeBtn.style.setProperty("--icon", "var(--black-icon-close)");
  closeBtn.id = "projectMenuCloseBtn";
  menuBox.appendChild(closeBtn);

  const pinBtn = document.createElement("button");
  pinBtn.className = "tool-button";
  pinBtn.title = "Tänd/släck projektpins";
  pinBtn.style.setProperty("--icon", "var(--black-icon-pin)");
  pinBtn.id = "projectMenuTogglePinsBtn";
  menuBox.appendChild(pinBtn);

  const header = document.createElement("div");
  header.className = "project-menu-header";
  header.textContent = "Pågående projekt";
  menuBox.appendChild(header);

  const list = document.createElement("div");
  list.className = "project-list";
  menuBox.appendChild(list);

  // Sidebar
  const sidebar = document.createElement("aside");
  sidebar.id = "projectSidebar";
  sidebar.className = "project-sidebar";
  sidebar.style.display = "none";
  document.body.appendChild(sidebar);

  const sidebarClose = document.createElement("button");
  sidebarClose.className = "tool-button project-sidebar-close";
  sidebarClose.title = "Stäng projekt";
  sidebarClose.style.setProperty("--icon", "var(--black-icon-close)");
  sidebar.appendChild(sidebarClose);

  const sidebarZoom = document.createElement("button");
  sidebarZoom.className = "tool-button project-sidebar-zoom";
  sidebarZoom.title = "Zooma till projekt";
  sidebarZoom.style.setProperty("--icon", "var(--black-icon-zoom-in)");
  sidebar.appendChild(sidebarZoom);

  const sidebarCollapse = document.createElement("button");
  sidebarCollapse.className = "tool-button project-sidebar-collapse";
  sidebarCollapse.title = "Minimera panel";
  sidebarCollapse.style.setProperty("--icon", "var(--black-icon-collapse-panel)");
  sidebar.appendChild(sidebarCollapse);

  const sidebarContent = document.createElement("div");
  sidebarContent.className = "project-sidebar-content";
  sidebar.appendChild(sidebarContent);

  // --- State ---
  const loadedTilesets = {};
  const loadedWMSImagery = {};
  let currentProjectIndex = null;

  // --- NEW: Terrain clipping state ---
  let terrainClippingEnabled = false;

// -----------------------------
// Camera lock to project pin (no camera restore on close)
// -----------------------------
let cameraLockSavedController = null;

function enableCameraLockToProjectPin(project) {
  if (project?.["lock-camera"] !== true) return false;

  const pin = project?.pin;
  const startPos = project?.["start-location"]?.position;

  if (!pin || !startPos) return false;

  const { lng, lat, height = 0 } = pin;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (!Number.isFinite(startPos.lng) || !Number.isFinite(startPos.lat)) return false;

  const center = Cartesian3.fromDegrees(lng, lat, height);
  const startWorld = Cartesian3.fromDegrees(
    startPos.lng,
    startPos.lat,
    startPos.height ?? 1000
  );

  const transform = Transforms.eastNorthUpToFixedFrame(center);

  // Save controller state once
  if (!cameraLockSavedController) {
    const ssc0 = viewer.scene.screenSpaceCameraController;
    cameraLockSavedController = {
      enableTranslate: ssc0.enableTranslate,
      enableTilt: ssc0.enableTilt,
      enableLook: ssc0.enableLook
    };
  }

  // Lock controller
  const ssc = viewer.scene.screenSpaceCameraController;
  ssc.enableTranslate = false;
  ssc.enableLook = false;
  ssc.enableTilt = true;

  // Convert world coordinates -> local offset in pin's ENU system
  const invTransform = Matrix4.inverseTransformation(transform, new Matrix4());
  const localOffset = Matrix4.multiplyByPoint(invTransform, startWorld, new Cartesian3());

  // Protection against strange configurations
  const mag = Cartesian3.magnitude(localOffset);
  if (!Number.isFinite(mag) || mag < 1.0) {
    console.warn("[projectMenu] Invalid camera offset for project lock");
    viewer.camera.lookAtTransform(
      transform,
      new HeadingPitchRange(viewer.camera.heading, viewer.camera.pitch, 2000.0)
    );
    return true;
  }

  // Exact camera position relative to the pin; camera looks at the pin
  viewer.camera.lookAtTransform(transform, localOffset);
  return true;
}

function disableCameraLock() {
  const ssc = viewer.scene.screenSpaceCameraController;

  // Release transform lock (without moving the camera to the previous position)
  viewer.camera.lookAtTransform(Matrix4.IDENTITY);

  // Restore only controller flags
  if (cameraLockSavedController) {
    ssc.enableTranslate = cameraLockSavedController.enableTranslate;
    ssc.enableTilt = cameraLockSavedController.enableTilt;
    ssc.enableLook = cameraLockSavedController.enableLook;
    cameraLockSavedController = null;
  }
}

function projectHasTerrainClipping(project) {
  return hasTerrainClippingSpec(project);
}
function projectHasTilesetClipping(project) {
  return hasTilesetClippingSpec(project);
}

  function clearTerrainClipping() {
    terrainClippingEnabled = false;
    viewer.scene.globe.clippingPolygons = undefined;
    viewer.scene.requestRender();
  }

async function applyProjectTerrainClipping(project) {
  const myReq = ++terrainClipReqId;

  if (!terrainClipFeatureEnabledByConfig(project)) {
    clearTerrainClipping();
    return;
  }

  let pairs = null;
  try {
    pairs = await resolveClippingPositionsFromProject(project, "terrain");
  } catch (e) {
    console.warn("[terrainClipping] kunde inte läsa klippmask:", e);
    pairs = null;
  }

  // If the project changed while we were waiting: ignore
  if (myReq !== terrainClipReqId) return;

  const degrees = flattenLonLatPairs(pairs || []);
  if (degrees.length < 6) {
    clearTerrainClipping();
    return;
  }

  const pointCount = pairs?.length ?? 0;
  const maxPoints = getClippingMaxPoints(project, "terrain", 5000);

  if (pointCount > maxPoints) {
    console.warn(
      `[terrainClipping] För många punkter i klippmask (${pointCount} > ${maxPoints})`
    );
    clearTerrainClipping();
    return;
  }

  const positions = Cartesian3.fromDegreesArray(degrees);

  viewer.scene.globe.clippingPolygons = new ClippingPolygonCollection({
    polygons: [new ClippingPolygon({ positions })],
    inverse: !!project["inverse-terrain"],
    enabled: !!project["terrain-enableAtStart"]
  });

  terrainClippingEnabled = !!project["terrain-enableAtStart"];
  viewer.scene.requestRender();
}

  function setTerrainClippingEnabled(enabled) {
    terrainClippingEnabled = !!enabled;
    const cp = viewer.scene.globe.clippingPolygons;
    if (cp) cp.enabled = terrainClippingEnabled;
    viewer.scene.requestRender();
  }

function updateTerrainClippingToggleUI() {
  const el = sidebarContent.querySelector('input[type="checkbox"][data-terrain-clip-toggle="1"]');
  if (!el) return;

  const project = projects[parseInt(sidebar.dataset.projectIndex || "-1", 10)];
  const ok = terrainClipFeatureEnabledByConfig(project);

  el.disabled = !ok;
  el.checked = !!(ok && terrainClippingEnabled);
}
function updateTilesetClippingToggleUI() {
  const el = sidebarContent.querySelector('input[type="checkbox"][data-tileset-clip-toggle="1"]');
  if (!el) return;

  const project = projects[parseInt(sidebar.dataset.projectIndex || "-1", 10)];
  const ok = tilesetClipFeatureEnabledByConfig(project) && !!tilesetClipMgr?.hasPolygon?.();

  el.disabled = !ok;
  el.checked = !!(ok && tilesetClippingEnabled);
}
  // --- Helper functions ---
  function loadTileset(layer) {
    if (layer.ionAssetId) return Cesium3DTileset.fromIonAssetId(layer.ionAssetId, layer.options || {});
    return Cesium3DTileset.fromUrl(layer.url, layer.options || {});
  }

  function createImageryProvider(layer) {
    if (!layer) return null;
    if (layer.type === "OSM") return new OpenStreetMapImageryProvider();
    if (layer.type === "WMS" || (layer.provider && String(layer.provider).toUpperCase() === "WMS")) {
      return new WebMapServiceImageryProvider({ url: layer.url, layers: layer.layers, parameters: layer.parameters || {} });
    }
    if (layer.typeOptions && layer.typeOptions.wmtsOptions) {
      try {
        return new WebMapTileServiceImageryProvider(layer.typeOptions.wmtsOptions);
      } catch (e) {
        console.warn(e);
        return null;
      }
    }
    if (typeof layer.url === "string" && /\{z\}|\{x\}|\{y\}/.test(layer.url))
      return new UrlTemplateImageryProvider({ url: layer.url });
    if (layer.provider && String(layer.provider).toLowerCase() === "single" && layer.rectangle) {
      try {
        const r = layer.rectangle;
        const rect = Rectangle.fromDegrees(r.west, r.south, r.east, r.north);
        return new SingleTileImageryProvider({ url: layer.url, rectangle: rect });
      } catch (e) {
        console.warn(e);
        return null;
      }
    }
    return null;
  }

  // --- Fly to project start ---
function flyToStartLocation(project) {
  if (!project || !project["start-location"] || !viewer) return Promise.resolve();

  try {
    const pos = project["start-location"]?.position;
    const ori = project["start-location"]?.orientation;

    if (!pos) return Promise.resolve();

    const destination = Cartesian3.fromDegrees(pos.lng, pos.lat, pos.height ?? 1000);

    const heading = CesiumMath.toRadians(ori?.heading ?? 0);
    const pitch = CesiumMath.toRadians(ori?.pitch ?? -45);
    const roll = CesiumMath.toRadians(ori?.roll ?? 0);

    return viewer.camera.flyTo({
      destination,
      orientation: { heading, pitch, roll },
      duration: 1.2
    });
  } catch (e) {
    console.warn("Could not move to project start", e);
    return Promise.resolve();
  }
}
async function focusProjectCamera(project, opts = {}) {
  if (!project || !viewer) return;

  const {
    animate = true,
    duration = 1.8
  } = opts;

  const reqId = ++cameraFocusReqId;

  if (project?.["lock-camera"] === true) {
    disableCameraLock();

    if (animate) {
      const completed = await flyCameraToLockedProjectPose(project, { duration });

      // If a newer focus request has started, abort silently
      if (reqId !== cameraFocusReqId) return;

      if (completed) {
        enableCameraLockToProjectPin(project);
        return;
      }
    }

    // Fallback: set the final view directly without animation
    const ok = enableCameraLockToProjectPin(project);
    if (!ok) {
      await Promise.resolve(flyToStartLocation(project));
    }
    return;
  }

  disableCameraLock();
  await Promise.resolve(flyToStartLocation(project));
}
function flyCameraToLockedProjectPose(project, opts = {}) {
  const {
    duration = 1.8
  } = opts;

  return new Promise((resolve) => {
    if (!project || !viewer) {
      resolve(false);
      return;
    }

    const pin = project?.pin;
    const startPos = project?.["start-location"]?.position;

    if (!pin || !startPos) {
      resolve(false);
      return;
    }

    const pinLng = pin.lng;
    const pinLat = pin.lat;
    const pinHeight = Number.isFinite(pin.height) ? pin.height : 0;

    const camLng = startPos.lng;
    const camLat = startPos.lat;
    const camHeight = Number.isFinite(startPos.height) ? startPos.height : 1000;

    if (![pinLng, pinLat, camLng, camLat].every(Number.isFinite)) {
      resolve(false);
      return;
    }

    const destination = Cartesian3.fromDegrees(camLng, camLat, camHeight);
    const target = Cartesian3.fromDegrees(pinLng, pinLat, pinHeight);

    const direction = Cartesian3.normalize(
      Cartesian3.subtract(target, destination, new Cartesian3()),
      new Cartesian3()
    );

    // Robust "up" based on the Earth's normal at the camera's position
    let up = Ellipsoid.WGS84.geodeticSurfaceNormal(destination, new Cartesian3());

    // Säkerhetsfall om direction och up skulle bli nästan parallella
    const dot = Math.abs(Cartesian3.dot(direction, up));
    if (dot > 0.999) {
      const enu = Transforms.eastNorthUpToFixedFrame(destination);
      up = Matrix4.getColumn(enu, 2, new Cartesian3());
    }

    viewer.camera.flyTo({
      destination,
      orientation: {
        direction,
        up
      },
      duration,
      complete: () => resolve(true),
      cancel: () => resolve(false)
    });
  });
}
  // --- Project list ---
  function createProjectRowElement(proj, idx) {
    const row = document.createElement("div");
    row.className = "project-row";
    row.tabIndex = 0;
    row.dataset.projectIndex = idx;

    const title = document.createElement("div");
    title.className = "project-row-title";
    title.textContent = proj.name || `Projekt ${idx + 1}`;
    row.appendChild(title);

    row.addEventListener("click", () => {
      //flyToStartLocation(proj);
      openProjectSidebar(idx);
      menuBox.style.display = "none";
    });

    return row;
  }

  function renderProjectList() {
    const frag = document.createDocumentFragment();
    if (!projects.length) {
      const empty = document.createElement("div");
      empty.className = "project-empty";
      empty.textContent = "Inga projekt konfigurerade";
      frag.appendChild(empty);
    } else {
      projects.forEach((p, i) => frag.appendChild(createProjectRowElement(p, i)));
    }
    list.innerHTML = "";
    list.appendChild(frag);
  }

  // --- Sidebar content ---
  function buildSidebarContentFragment(project) {
    const frag = document.createDocumentFragment();

    const title = document.createElement("h2");
    title.className = "project-sidebar-title";
    title.textContent = project.name || "";
    frag.appendChild(title);

    const layersWrap = document.createElement("div");
    layersWrap.className = "project-layers";
    frag.appendChild(layersWrap);
    if (shouldShowTerrainClipRow(project)) {
    // --- NEW: Terrain clipping row (same style as layers) ---
    
      const item = document.createElement("div");
      item.className = "project-layer-row";
      item.dataset.layerIndex = "-999"; // just for styling/selector consistency

      const nameEl = document.createElement("div");
      nameEl.className = "project-layer-name";
      nameEl.textContent = "Klipp terräng";
      item.appendChild(nameEl);

      const switchWrap = document.createElement("label");
      switchWrap.className = "switch project-layer-switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = false;
      input.setAttribute("data-terrain-clip-toggle", "1");
      switchWrap.appendChild(input);
      const sliderSpan = document.createElement("span");
      sliderSpan.className = "slider";
      switchWrap.appendChild(sliderSpan);
      item.appendChild(switchWrap);
 
      // (optional) info panel below, if you want:
      const infoPanel = document.createElement("div");
      infoPanel.className = "project-layer-info";
      infoPanel.style.display = "none";
      infoPanel.dataset.layerIndex = "-999";

      const infoText = document.createElement("div");
      infoText.className = "project-layer-info-text";
      infoText.innerHTML = "<small>Klipper terrängen inom polygonen som är definierad i index.json (terrainClipping.positions).</small>";
      infoPanel.appendChild(infoText);

      layersWrap.append(item, infoPanel);
    
  }
  if (shouldShowTilesetClipRow(project))
    {
  const item = document.createElement("div");
  item.className = "project-layer-row";
  item.dataset.layerIndex = "-998";

  const nameEl = document.createElement("div");
  nameEl.className = "project-layer-name";
  nameEl.textContent = "Klipp 3D-tilesets";
  item.appendChild(nameEl);

  const switchWrap = document.createElement("label");
  switchWrap.className = "switch project-layer-switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = false;
  input.setAttribute("data-tileset-clip-toggle", "1");
  switchWrap.appendChild(input);

  const sliderSpan = document.createElement("span");
  sliderSpan.className = "slider";
  switchWrap.appendChild(sliderSpan);

  item.appendChild(switchWrap);

  const infoPanel = document.createElement("div");
  infoPanel.className = "project-layer-info";
  infoPanel.style.display = "none";
  infoPanel.dataset.layerIndex = "-998";

  const infoText = document.createElement("div");
  infoText.className = "project-layer-info-text";
  infoText.innerHTML =
    "<small>Klipper alla 3D-tilesets (från lagermenyn) med samma polygon som terrängklippningen.</small>";
  infoPanel.appendChild(infoText);

  layersWrap.append(item, infoPanel);
}

    const layers = Array.isArray(project.content) ? project.content : [];
    layers.forEach((layer, idx) => {
      const item = document.createElement("div");
      item.className = "project-layer-row";
      item.dataset.layerIndex = idx;
      item.dataset.layerName = layer.name || "";

      const nameEl = document.createElement("div");
      nameEl.className = "project-layer-name";
      nameEl.textContent = layer.name || layer.url;
      item.appendChild(nameEl);

      const switchWrap = document.createElement("label");
      switchWrap.className = "switch project-layer-switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!layer["visible-at-start"];
      input.dataset.layerIndex = idx;
      switchWrap.appendChild(input);
      const sliderSpan = document.createElement("span");
      sliderSpan.className = "slider";
      switchWrap.appendChild(sliderSpan);
      item.appendChild(switchWrap);

      const infoPanel = document.createElement("div");
      infoPanel.className = "project-layer-info";
      infoPanel.dataset.layerIndex = idx;

      const infoText = document.createElement("div");
      infoText.className = "project-layer-info-text";
      infoText.innerHTML = layer.infoText || "";
      const opacityLabel = document.createElement("label");
      opacityLabel.textContent = "Opacitet:";

      const opacitySlider = document.createElement("input");
      opacitySlider.type = "range";
      opacitySlider.min = 0;
      opacitySlider.max = 1;
      opacitySlider.step = 0.01;
      opacitySlider.value = 1;
      opacitySlider.dataset.layerIndex = idx;

      // --- MOBILE/WEB FRIENDLY OPACITY ---
      opacitySlider.addEventListener("input", () => {
        const v = parseFloat(opacitySlider.value);
        const projIdx = sidebar.dataset.projectIndex;
        const project = projects[projIdx];
        if (!project) return;
        const layer = project.content[idx];
        if (!layer) return;

        const isWMS =
          layer.type === "WMS" || (layer.provider && String(layer.provider).toUpperCase() === "WMS");

        if (isWMS) {
          const imgL = loadedWMSImagery[layer.name];
          if (imgL) imgL.alpha = v;
        } else {
          const ts = loadedTilesets[layer.name];
          if (ts) {
            ts.style = new Cesium3DTileStyle({
              color: `color('white', ${v})`
            });
          }
        }
      });

      infoPanel.append(infoText, opacityLabel, opacitySlider);
      layersWrap.append(item, infoPanel);
    });

    const desc = document.createElement("div");
    desc.className = "project-description";
    desc.innerHTML = project["html-description"] || "";

    desc.querySelectorAll('a[target="_blank"]').forEach((link) => {
      link.classList.add("external-link");
      link.setAttribute("rel", "noopener noreferrer");
    });
    // --- Add Close Text Button ---
    const textMinimizeBtn = document.createElement("button");
    textMinimizeBtn.className = "project-sidebar-text-minimize";
    textMinimizeBtn.textContent = "Göm text";
    textMinimizeBtn.title = "Dölj beskrivning";

    textMinimizeBtn.addEventListener("click", () => {
      const minimized = sidebar.classList.toggle("minimized");
      textMinimizeBtn.textContent = minimized ? "Visa text" : "Göm text";
    });

    frag.appendChild(textMinimizeBtn);
    frag.appendChild(desc);

    return frag;
  }

  // --- Layer delegation ---
 function attachLayersDelegation() {
  const layersWrap = sidebarContent.querySelector(".project-layers");
  if (!layersWrap || layersWrap.__delegationAttached) return;
  layersWrap.__delegationAttached = true;

  layersWrap.addEventListener("click", (ev) => {
    const nameEl = ev.target.closest(".project-layer-name");
    if (nameEl) {
      const row = nameEl.closest(".project-layer-row");
      const idx = row.dataset.layerIndex;
      const info = sidebarContent.querySelector(`.project-layer-info[data-layer-index="${idx}"]`);
      if (info) info.style.display = info.style.display === "block" ? "none" : "block";
      return;
    }

    const terrainToggle = ev.target.closest('input[type="checkbox"][data-terrain-clip-toggle="1"]');
    if (terrainToggle) {
      ev.stopPropagation();

      const project = projects[parseInt(sidebar.dataset.projectIndex || "-1", 10)];
      if (!projectHasTerrainClipping(project)) {
        terrainToggle.checked = false;
        terrainToggle.disabled = true;
        return;
      }

      setTerrainClippingEnabled(terrainToggle.checked);
      updateTerrainClippingToggleUI();
      return;
    }

    const tilesetToggle = ev.target.closest(
      'input[type="checkbox"][data-tileset-clip-toggle="1"]'
    );
    if (tilesetToggle) {
      ev.stopPropagation();

      const has = !!tilesetClipMgr?.hasPolygon();
      if (!has) {
        tilesetToggle.checked = false;
        tilesetToggle.disabled = true;
        tilesetClippingEnabled = false;
        tilesetClipMgr?.setEnabled(false);
        return;
      }

      tilesetClippingEnabled = tilesetToggle.checked;
      tilesetClipMgr?.setEnabled(tilesetClippingEnabled);
      updateTilesetClippingToggleUI();
      return;
    }

    const chk = ev.target.closest('input[type="checkbox"][data-layer-index]');
    if (chk) {
      ev.stopPropagation();

      const layerIndex = parseInt(chk.dataset.layerIndex, 10);
      const projIdx = parseInt(sidebar.dataset.projectIndex || "-1", 10);
      const sessionId = projectSessionId;

      const project = projects[projIdx];
      if (!project) return;

      const layer = project.content?.[layerIndex];
      if (!layer) return;

      (async () => {
        const infoPanel = sidebarContent.querySelector(
          `.project-layer-info[data-layer-index="${layerIndex}"]`
        );
        const opacitySlider = infoPanel
          ? infoPanel.querySelector('input[type="range"]')
          : null;
        const opacity = opacitySlider ? parseFloat(opacitySlider.value) : 1;

        const isWMS =
          layer.type === "WMS" ||
          (layer.provider && String(layer.provider).toUpperCase() === "WMS");

        if (chk.checked) {
          if (isWMS) {
            if (!isProjectSessionActive(sessionId, projIdx)) return;

            const provider = createImageryProvider(layer);
            if (!provider) {
              if (isProjectSessionActive(sessionId, projIdx)) chk.checked = false;
              return;
            }

            if (!isProjectSessionActive(sessionId, projIdx)) return;

            const existing = loadedWMSImagery[layer.name];
            if (existing) {
              existing.alpha = opacity;
              try {
                viewer.imageryLayers.raiseToTop(existing);
              } catch {}
              return;
            }

            const imgLayer = viewer.imageryLayers.addImageryProvider(provider);
            imgLayer.alpha = opacity;
            loadedWMSImagery[layer.name] = imgLayer;

            try {
              viewer.imageryLayers.raiseToTop(imgLayer);
            } catch {}
          } else {
            try {
              const existing = loadedTilesets[layer.name];
              if (existing) {
                existing.style = new Cesium3DTileStyle({
                  color: `color('white', ${opacity})`
                });
                return;
              }

              const tsObj = await loadTileset(layer);

              if (!isProjectSessionActive(sessionId, projIdx)) {
                tsObj?.destroy?.();
                return;
              }

              viewer.scene.primitives.add(tsObj);
              tsObj.style = new Cesium3DTileStyle({
                color: `color('white', ${opacity})`
              });
              loadedTilesets[layer.name] = tsObj;
            } catch {
              if (isProjectSessionActive(sessionId, projIdx)) {
                chk.checked = false;
              }
            }
          }
        } else {
          if (isWMS) {
            const img = loadedWMSImagery[layer.name];
            if (img) {
              viewer.imageryLayers.remove(img, true);
              delete loadedWMSImagery[layer.name];
            }
          } else {
            const ts = loadedTilesets[layer.name];
            if (ts) {
              viewer.scene.primitives.remove(ts);
              delete loadedTilesets[layer.name];
            }
          }
        }
      })();

      return;
    }
  });
}

// --- Open/close sidebar ---
async function openProjectSidebar(projectIndex) {
  const project = projects[projectIndex];
  if (!project) return;

  const sidebarIsOpen = sidebar.style.display !== "none";
  const isSameProject = currentProjectIndex === projectIndex;

  // If the same project is already open: just focus the camera
  if (isSameProject && sidebarIsOpen) {
    await focusProjectCamera(project, { animate: true, duration: 1.8 });
    return;
  }

  // Invalidate all older async flows
  const sessionId = invalidateProjectSession();

  // Release any previous camera lock/flight immediately
  disableCameraLock();
  cameraFocusReqId++;
  viewer.camera.cancelFlight?.();

  // Clear previous project's layers
  if (currentProjectIndex !== null && currentProjectIndex !== projectIndex) {
    unloadProjectLayers(currentProjectIndex);
  }

  // Clear terrain clipping immediately when a new project starts opening
  terrainClipReqId++;
  clearTerrainClipping();

  // Clear tileset clipping immediately when a new project starts opening
  tilesetClippingEnabled = false;
  tilesetClipMgr?.setEnabled(false);
  tilesetClipMgr?.clearPolygon?.();

  currentProjectIndex = projectIndex;
  sidebar.style.display = "block";
  sidebar.dataset.projectIndex = String(projectIndex);
  sidebarContent.innerHTML = "";

  // Tilesets clipping
  if (tilesetClipFeatureEnabledByConfig(project)) {
    const hasPoly = await tilesetClipMgr?.setPolygonFromProjectAsync(project, {
      inverse: !!project["inverse-tilesets"]
    });

    if (!isProjectSessionActive(sessionId, projectIndex)) {
      tilesetClipMgr?.setEnabled(false);
      tilesetClipMgr?.clearPolygon?.();
      return;
    }

    tilesetClippingEnabled = !!(hasPoly && project["tileset-enableAtStart"]);
    tilesetClipMgr?.setEnabled(tilesetClippingEnabled);
  } else {
    tilesetClippingEnabled = false;
    tilesetClipMgr?.setEnabled(false);
    tilesetClipMgr?.clearPolygon?.();
  }

  // Terrain clipping
  await applyProjectTerrainClipping(project);
  if (!isProjectSessionActive(sessionId, projectIndex)) return;

  // Reset minimizer state
  sidebar.classList.remove("minimized");

  const layersList = sidebar.querySelector(".project-layers");
  if (layersList) layersList.classList.remove("minimized");

  const textBtn = sidebar.querySelector(".project-sidebar-text-minimize");
  if (textBtn) textBtn.textContent = "Göm text";

  sidebarCollapse.style.setProperty("--icon", "var(--black-icon-collapse-panel)");

  const frag = buildSidebarContentFragment(project);
  if (!isProjectSessionActive(sessionId, projectIndex)) return;

  sidebarContent.innerHTML = "";
  sidebarContent.appendChild(frag);
  attachLayersDelegation();

  updateTerrainClippingToggleUI();
  updateTilesetClippingToggleUI();

  await focusProjectCamera(project, { animate: true, duration: 1.8 });
  if (!isProjectSessionActive(sessionId, projectIndex)) return;

  const layers = Array.isArray(project.content) ? project.content : [];
  for (let i = 0; i < layers.length; i++) {
    if (!isProjectSessionActive(sessionId, projectIndex)) return;

    const layer = layers[i];
    if (!layer["visible-at-start"]) continue;

    const isWMS =
      layer.type === "WMS" ||
      (layer.provider && String(layer.provider).toUpperCase() === "WMS");

    const infoPanel = sidebarContent.querySelector(
      `.project-layer-info[data-layer-index="${i}"]`
    );
    const opacitySlider = infoPanel
      ? infoPanel.querySelector('input[type="range"]')
      : null;
    const opacity = opacitySlider ? parseFloat(opacitySlider.value) : 1;

    try {
      if (isWMS) {
        if (loadedWMSImagery[layer.name]) {
          const existing = loadedWMSImagery[layer.name];
          existing.alpha = opacity;
          try {
            viewer.imageryLayers.raiseToTop(existing);
          } catch {}
        } else {
          const provider = createImageryProvider(layer);
          if (!provider) continue;

          if (!isProjectSessionActive(sessionId, projectIndex)) return;

          const imgLayer = viewer.imageryLayers.addImageryProvider(provider);
          imgLayer.alpha = opacity;
          loadedWMSImagery[layer.name] = imgLayer;

          try {
            viewer.imageryLayers.raiseToTop(imgLayer);
          } catch {}
        }
      } else {
        if (loadedTilesets[layer.name]) {
          loadedTilesets[layer.name].style = new Cesium3DTileStyle({
            color: `color('white', ${opacity})`
          });
        } else {
          const tsObj = await loadTileset(layer);

          if (!isProjectSessionActive(sessionId, projectIndex)) {
            tsObj?.destroy?.();
            return;
          }

          viewer.scene.primitives.add(tsObj);
          tsObj.style = new Cesium3DTileStyle({
            color: `color('white', ${opacity})`
          });
          loadedTilesets[layer.name] = tsObj;
        }
      }

      const checkbox = sidebarContent.querySelector(
        `input[type="checkbox"][data-layer-index="${i}"]`
      );
      if (checkbox && isProjectSessionActive(sessionId, projectIndex)) {
        checkbox.checked = true;
      }
    } catch (e) {
      console.warn("Kunde inte ladda lager vid start:", e);
    }
  }
}

function closeProjectSidebar() {
  // Invalidate all present async flows
  invalidateProjectSession();

  unloadProjectLayers(currentProjectIndex);

  currentProjectIndex = null;
  sidebar.dataset.projectIndex = "";
  sidebar.style.display = "none";
  sidebarContent.innerHTML = "";

  // Clear terrain clipping when closing project
  terrainClipReqId++;
  clearTerrainClipping();

  // Clear tileset clipping when closing project
  tilesetClippingEnabled = false;
  tilesetClipMgr?.setEnabled(false);
  tilesetClipMgr?.clearPolygon?.();

  // Release camera lock when closing project
  disableCameraLock();
  cameraFocusReqId++;
  viewer.camera.cancelFlight?.();
}

  // --- Events ---
  toggleBtn.addEventListener("click", () => {
    menuBox.style.display = menuBox.style.display === "block" ? "none" : "block";
  });
  closeBtn.addEventListener("click", () => (menuBox.style.display = "none"));
  sidebarClose.addEventListener("click", closeProjectSidebar);
  sidebarZoom.addEventListener("click", async () => {
    const idxStr = sidebar.dataset.projectIndex;
    if (!idxStr) return;

    const idx = parseInt(idxStr, 10);
    const project = projects[idx];
    if (!project) return;

    await focusProjectCamera(project, { animate: true, duration: 1.8 });
  });
  // --- Collapse sidebar (nytt beteende) ---
  sidebarCollapse.addEventListener("click", () => {
    const list = document.querySelector(".project-layers");
    const textEl = document.querySelector(".project-sidebar-text-minimize");

    const sidebarMin = sidebar.classList.contains("minimized");
    const listMin = list?.classList.contains("minimized");

    if (!sidebarMin && !listMin) {
      sidebar.classList.add("minimized");
      list?.classList.add("minimized");
    } else if (sidebarMin && !listMin) {
      list?.classList.add("minimized");
    } else if (!sidebarMin && listMin) {
      list?.classList.remove("minimized");
    } else {
      sidebar.classList.remove("minimized");
      list?.classList.remove("minimized");
    }

    const minimized = sidebar.classList.contains("minimized");
    sidebarCollapse.style.setProperty(
      "--icon",
      minimized ? "var(--black-icon-open-panel)" : "var(--black-icon-collapse-panel)"
    );

    if (textEl) textEl.textContent = minimized ? "Visa text" : "Göm text";
  });

  // -----------------------------
  // Add project pins in Cesium
  // -----------------------------
  let pinsEnabled = true;
  const projectPins = [];

  projects.forEach((proj, index) => {
    if (!proj.pin) return;

    const { lng, lat, height = 0 } = proj.pin;

    // Create an entity/pin in Cesium
    const entity = viewer.entities.add({
      position: Cartesian3.fromDegrees(lng, lat, height),
      billboard: {
        image: "./images/icons/Pin_med_hammare.png",
        scale: 0.05,
        verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new DistanceDisplayCondition(0.0, 15000.0)
      },
      label: {
        text: proj.name || "Projekt",
        font: "18px sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        pixelOffset: new Cartesian2(0, -60),
        distanceDisplayCondition: new DistanceDisplayCondition(0.0, 15000.0)
      },

      properties: {
        isProjectPin: true,
        projectIndex: index // SUPER IMPORTANT
      }
    });

    projectPins.push(entity);
    console.log("[projectMenu] init start", Date.now());
    console.log("[projectMenu] creating pins", projects.length);
      });

  // -------------------------------------
  // Click event: open project via entity
  // -------------------------------------
  const pinClickHandler = new ScreenSpaceEventHandler(viewer.canvas);

  pinClickHandler.setInputAction(
    (movement) => {
      if (!pinsEnabled) return;
      console.log("pin click handler fired");
      const picked = viewer.scene.pick(movement.position);
      if (!picked || !picked.id) return;

      const id = picked.id;

      // Is this a project pin?
      if (!id.properties || !id.properties.projectIndex) return;

      

      const projIndex = id.properties.projectIndex.getValue();
      const project = projects[projIndex];
      if (!project) return;

      // Open the project
      //flyToStartLocation(project);
      openProjectSidebar(projIndex);
      menuBox.style.display = "none";
    },
    ScreenSpaceEventType.LEFT_CLICK
  );
  
  // Failsafe for infobox to pop up when clicking pin
  viewer.selectedEntityChanged.addEventListener((entity) => {
    if (!entity?.properties?.projectIndex) return; // pins have projectIndex
    viewer.selectedEntity = undefined;
  });

  // --- Init ---
  renderProjectList();

  function togglePins() {
    pinsEnabled = !pinsEnabled;

    projectPins.forEach((e) => {
      if (e.billboard) e.billboard.show = pinsEnabled;
      if (e.label) e.label.show = pinsEnabled;
    });

    viewer.scene.requestRender();

    pinBtn.style.setProperty("--icon", pinsEnabled ? "var(--black-icon-pin)" : "var(--black-icon-pin-off)");
  }
  pinBtn.addEventListener("click", togglePins);

  const api = { openProjectSidebar, closeProjectSidebar, loadedTilesets, loadedWMSImagery };
  viewer.__projectMenuApi = api;
  return api;
  
}