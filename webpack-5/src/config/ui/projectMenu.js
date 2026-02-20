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
  ScreenSpaceEventHandler,
  DistanceDisplayCondition,
  HeightReference,
  Color,
  LabelStyle,
  Cartesian2,
  ScreenSpaceEventType,
  Math as CesiumMath
} from "cesium";

export default function initProjectMenuUI(viewer, config = {}) {
  const projects = Array.isArray(config.projects) ? config.projects : [];
  if (projects.length === 0 ) {
    console.warn("Inga projekt hittades i configen - projektmenyn initieras inte.")
    return {};
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
      try { return new WebMapTileServiceImageryProvider(layer.typeOptions.wmtsOptions); } catch (e) { console.warn(e); return null; }
    }
    if (typeof layer.url === "string" && /\{z\}|\{x\}|\{y\}/.test(layer.url))
      return new UrlTemplateImageryProvider({ url: layer.url });
    if (layer.provider && String(layer.provider).toLowerCase() === "single" && layer.rectangle) {
      try {
        const r = layer.rectangle;
        const rect = Rectangle.fromDegrees(r.west, r.south, r.east, r.north);
        return new SingleTileImageryProvider({ url: layer.url, rectangle: rect });
      } catch (e) { console.warn(e); return null; }
    }
    return null;
  }

  // --- Fly to project start ---
  function flyToStartLocation(project) {
    if (!project || !project["start-location"] || !viewer) return;
    try {
      const pos = project["start-location"].position || {};
      const ori = project["start-location"].orientation || {};
      const cart = Cartesian3.fromDegrees(pos.lng || 0, pos.lat || 0, pos.height || 0);
      viewer.camera.flyTo({
        destination: cart,
        orientation: {
          heading: CesiumMath.toRadians(ori.heading || 0),
          pitch: CesiumMath.toRadians(ori.pitch || -45),
          roll: CesiumMath.toRadians(ori.roll || 0)
        },
        duration: 1.2
      });
    } catch (e) { console.warn("Kunde inte flytta till projektstart", e); }
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
      flyToStartLocation(proj);
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

        const isWMS = layer.type === "WMS" || 
          (layer.provider && String(layer.provider).toUpperCase() === "WMS");

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

    // --- Lägg till "Stäng text"-knappen ---
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

      const chk = ev.target.closest('input[type="checkbox"]');
      if (chk) {
        ev.stopPropagation();
        const layerIndex = parseInt(chk.dataset.layerIndex, 10);
        const projIdx = parseInt(sidebar.dataset.projectIndex, 10);
        const project = projects[projIdx];
        if (!project) return;
        const layer = project.content[layerIndex];
        if (!layer) return;

        (async () => {
          const infoPanel = sidebarContent.querySelector(`.project-layer-info[data-layer-index="${layerIndex}"]`);
          const opacitySlider = infoPanel ? infoPanel.querySelector('input[type="range"]') : null;
          const opacity = opacitySlider ? parseFloat(opacitySlider.value) : 1;
          const isWMS = layer.type === "WMS" || (layer.provider && String(layer.provider).toUpperCase() === "WMS");

          if (chk.checked) {
            if (isWMS) {
              const provider = createImageryProvider(layer);
              if (!provider) { chk.checked = false; return; }
              const imgLayer = viewer.imageryLayers.addImageryProvider(provider);
              imgLayer.alpha = opacity;
              loadedWMSImagery[layer.name] = imgLayer;
              try { viewer.imageryLayers.raiseToTop(imgLayer); } catch {}
            } else {
              try {
                const tsObj = await loadTileset(layer);
                viewer.scene.primitives.add(tsObj);
                tsObj.style = new Cesium3DTileStyle({ color: `color('white', ${opacity})` });
                loadedTilesets[layer.name] = tsObj;
              } catch { chk.checked = false; }
            }
          } else {
            if (isWMS) {
              const img = loadedWMSImagery[layer.name];
              if (img) { viewer.imageryLayers.remove(img, true); delete loadedWMSImagery[layer.name]; }
            } else {
              const ts = loadedTilesets[layer.name];
              if (ts) { viewer.scene.primitives.remove(ts); delete loadedTilesets[layer.name]; }
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

    if (currentProjectIndex !== null && currentProjectIndex !== projectIndex) {
      const prevProject = projects[currentProjectIndex];
      if (prevProject && Array.isArray(prevProject.content)) {
        prevProject.content.forEach(layer => {
          const isWMS = layer.type === "WMS" || (layer.provider && String(layer.provider).toUpperCase() === "WMS");
          if (isWMS) {
            const img = loadedWMSImagery[layer.name];
            if (img) { viewer.imageryLayers.remove(img, true); delete loadedWMSImagery[layer.name]; }
          } else {
            const ts = loadedTilesets[layer.name];
            if (ts) { viewer.scene.primitives.remove(ts); delete loadedTilesets[layer.name]; }
          }
        });
      }
    }

    currentProjectIndex = projectIndex;
    sidebar.style.display = "block";
    sidebar.dataset.projectIndex = projectIndex;

    // --- Återställ minimizer-state när sidebaren öppnas ---
    sidebar.classList.remove("minimized");

    const layersList = sidebar.querySelector(".project-layers");
    if (layersList) layersList.classList.remove("minimized");

    // Knappen för "Göm/Visa text" måste också återställas
    const textBtn = sidebar.querySelector(".project-sidebar-text-minimize");
    if (textBtn) textBtn.textContent = "Göm text";

    // Återställ ikon för collapse-knappen
    sidebarCollapse.style.setProperty("--icon", "var(--black-icon-collapse-panel)");


    const frag = buildSidebarContentFragment(project);
    sidebarContent.innerHTML = "";
    sidebarContent.appendChild(frag);
    attachLayersDelegation();

    const layers = Array.isArray(project.content) ? project.content : [];
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer["visible-at-start"]) continue;

      const isWMS = layer.type === "WMS" || (layer.provider && String(layer.provider).toUpperCase() === "WMS");
      const opacity = 1;

      try {
        if (isWMS) {
          const provider = createImageryProvider(layer);
          if (!provider) continue;
          const imgLayer = viewer.imageryLayers.addImageryProvider(provider);
          imgLayer.alpha = opacity;
          loadedWMSImagery[layer.name] = imgLayer;
          try { viewer.imageryLayers.raiseToTop(imgLayer); } catch {}
        } else {
          const tsObj = await loadTileset(layer);
          viewer.scene.primitives.add(tsObj);
          tsObj.style = new Cesium3DTileStyle({ color: `color('white', ${opacity})` });
          loadedTilesets[layer.name] = tsObj;
        }

        const checkbox = sidebarContent.querySelector(`input[type="checkbox"][data-layer-index="${i}"]`);
        if (checkbox) checkbox.checked = true;
      } catch (e) {
        console.warn("Kunde inte ladda lager vid start:", e);
      }
    }
  }

  function closeProjectSidebar() {
    const idxStr = sidebar.dataset.projectIndex;
    if (idxStr) {
      const projectIndex = parseInt(idxStr, 10);
      const project = projects[projectIndex];
      if (project && Array.isArray(project.content)) {
        project.content.forEach(layer => {
          const isWMS = layer.type === "WMS" || (layer.provider && String(layer.provider).toUpperCase() === "WMS");
          if (isWMS) {
            const img = loadedWMSImagery[layer.name];
            if (img) { viewer.imageryLayers.remove(img, true); delete loadedWMSImagery[layer.name]; }
          } else {
            const ts = loadedTilesets[layer.name];
            if (ts) { viewer.scene.primitives.remove(ts); delete loadedTilesets[layer.name]; }
          }
        });
      }
    }
    sidebar.dataset.projectIndex = "";
    sidebar.style.display = "none";
    sidebarContent.innerHTML = "";
  }

  // --- Events ---
  toggleBtn.addEventListener("click", () => {
    menuBox.style.display = menuBox.style.display === "block" ? "none" : "block";
  });
  closeBtn.addEventListener("click", () => (menuBox.style.display = "none"));
  sidebarClose.addEventListener("click", closeProjectSidebar);
  sidebarZoom.addEventListener("click", () => {
    const idxStr = sidebar.dataset.projectIndex;
    if (!idxStr) return;
    const project = projects[parseInt(idxStr, 10)];
    if (project) flyToStartLocation(project);
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
// Lägg till projekt-pins i Cesium
// -----------------------------
let pinsEnabled = true;
const projectPins = [];

projects.forEach((proj, index) => {
  if (!proj.pin) return;

  const { lng, lat, height = 0 } = proj.pin;

  // Skapa en entitet/pin i Cesium
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
    pixelOffset: new Cartesian2(0, -60), // Flyttar texten ovanför pinnen
    distanceDisplayCondition: new DistanceDisplayCondition(0.0, 15000.0) // Dölj vid zoom ut
  },

    properties: {
      projectIndex: index // SUPER VIKTIGT
    }
  });

  projectPins.push(entity);
});

// -------------------------------------
// Klick-event: öppna projekt via entitet
// -------------------------------------
const pinClickHandler = new ScreenSpaceEventHandler(viewer.canvas);

pinClickHandler.setInputAction((movement) => {
  if (!pinsEnabled) return;
  
  const picked = viewer.scene.pick(movement.position);
  if (!picked || !picked.id) return; // Klickade på något annat

  const id = picked.id;

  // Är detta en projekt-pin?
  if (!id.properties || !id.properties.projectIndex) return;

  const projIndex = id.properties.projectIndex.getValue();
  const project = projects[projIndex];
  if (!project) return;

  // Öppna projektet
  flyToStartLocation(project);
  openProjectSidebar(projIndex);
  menuBox.style.display = "none";

}, ScreenSpaceEventType.LEFT_CLICK);


  // --- Init ---
  renderProjectList();

function togglePins() {
  pinsEnabled = !pinsEnabled;

  projectPins.forEach(pin => {
    pin.show = pinsEnabled;
  });

  pinBtn.style.setProperty(
    "--icon",
    pinsEnabled ? "var(--black-icon-pin)" : "var(--black-icon-pin-off)"
  );
}
pinBtn.addEventListener("click", togglePins);

  return { openProjectSidebar, closeProjectSidebar, loadedTilesets, loadedWMSImagery };
}
