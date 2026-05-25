// src/tools/measure/index.js

import initMeasureArea from "./measure-area.js";
import initMeasureDistance from "./measure-distance.js";
import initMeasureHeight from "./measure-height.js";
import "./style.css";

/**
 * Initializes the main "Measure Tools" panel.
 * This panel contains three sub‑tools:
 *  - Area measurement
 *  - Distance measurement
 *  - Height measurement
 *
 * Each sub‑tool is rendered inside its own container and exposes a `.stop()`
 * method that disables its active measurement mode.
 *
 * @param {HTMLElement} panel - The UI panel where the tool is rendered
 * @param {Viewer} viewer - The Cesium Viewer instance
 */
export default function initMeasure(panel, viewer) {
  // Header
  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = "Mätverktyg";
  panel.appendChild(header);

  // NEW: one shared body for the whole measure tool
  const body = document.createElement("div");
  body.className = "panel-body";
  panel.appendChild(body);

  // Tabs
  const tabs = document.createElement("div");
  tabs.className = "measure-tabs";

  const areaTab = document.createElement("button");
  const distTab = document.createElement("button");
  const heightTab = document.createElement("button");

  areaTab.textContent = "Area";
  distTab.textContent = "Distans";
  heightTab.textContent = "Höjd";

  areaTab.classList.add("active");

  tabs.append(areaTab, distTab, heightTab);
  body.appendChild(tabs);

  // Containers
  const containerArea = document.createElement("div");
  const containerDist = document.createElement("div");
  const containerHeight = document.createElement("div");

  containerArea.className = "measure-container";
  containerDist.className = "measure-container";
  containerHeight.className = "measure-container";

  body.append(containerArea, containerDist, containerHeight);

  // Init subtools
 const areaApi = initMeasureArea(containerArea, viewer);
const distApi = initMeasureDistance(containerDist, viewer);
const heightApi = initMeasureHeight(containerHeight, viewer);

function stopAllMeasurements() {
  areaApi.stop();
  distApi.stop();
  heightApi.stop();
}

// initial state
containerArea.style.display = "block";
containerDist.style.display = "none";
containerHeight.style.display = "none";

areaTab.addEventListener("click", () => {
  stopAllMeasurements();

  areaTab.classList.add("active");
  distTab.classList.remove("active");
  heightTab.classList.remove("active");

  containerArea.style.display = "block";
  containerDist.style.display = "none";
  containerHeight.style.display = "none";
});

distTab.addEventListener("click", () => {
  stopAllMeasurements();

  distTab.classList.add("active");
  areaTab.classList.remove("active");
  heightTab.classList.remove("active");

  containerArea.style.display = "none";
  containerDist.style.display = "block";
  containerHeight.style.display = "none";
});

heightTab.addEventListener("click", () => {
  stopAllMeasurements();

  heightTab.classList.add("active");
  areaTab.classList.remove("active");
  distTab.classList.remove("active");

  containerArea.style.display = "none";
  containerDist.style.display = "none";
  containerHeight.style.display = "block";
});

//
// MutationObserver to stop measurements when panel is hidden or minimized
//

new MutationObserver(() => {
  const panelHidden = getComputedStyle(panel).display === "none";
  const panelMinimized = panel.classList.contains("is-minimized");

  if (panelHidden || panelMinimized) {
    stopAllMeasurements();
  }
}).observe(panel, {
  attributes: true,
  attributeFilter: ["style", "class"]
});
}
