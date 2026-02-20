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

  // ───────────────────────────────────────────────────────────────
  // 0) Header (also used for dragging the panel)
  // ───────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = "Mätverktyg";
  panel.appendChild(header);

  // ───────────────────────────────────────────────────────────────
  // 1) Tab buttons (Area / Distance / Height)
  // ───────────────────────────────────────────────────────────────
  const tabs = document.createElement("div");
  tabs.className = "measure-tabs";

  const areaTab = document.createElement("button");
  const distTab = document.createElement("button");
  const heightTab = document.createElement("button");

  areaTab.textContent = "Area";
  distTab.textContent = "Distans";
  heightTab.textContent = "Höjd";

  // Area is active by default
  areaTab.classList.add("active");

  tabs.append(areaTab, distTab, heightTab);
  panel.appendChild(tabs);

  // ───────────────────────────────────────────────────────────────
  // 2) Containers for each measurement tool
  // ───────────────────────────────────────────────────────────────
  const containerArea = document.createElement("div");
  const containerDist = document.createElement("div");
  const containerHeight = document.createElement("div");

  containerArea.className = "measure-container";
  containerDist.className = "measure-container";
  containerHeight.className = "measure-container";

  panel.append(containerArea, containerDist, containerHeight);

  // ───────────────────────────────────────────────────────────────
  // 3) Initialize sub‑tools
  // Each init returns an API object: { stop: Function }
  // ───────────────────────────────────────────────────────────────
  const areaApi = initMeasureArea(containerArea, viewer);
  const distApi = initMeasureDistance(containerDist, viewer);
  const heightApi = initMeasureHeight(containerHeight, viewer);

  // ───────────────────────────────────────────────────────────────
  // 4) Show only the Area tool initially
  // ───────────────────────────────────────────────────────────────
  containerArea.style.display = "block";
  containerDist.style.display = "none";
  containerHeight.style.display = "none";

  // ───────────────────────────────────────────────────────────────
  // 5) Tab switching logic
  // Only one tool container is visible at a time
  // ───────────────────────────────────────────────────────────────
  areaTab.addEventListener("click", () => {
    areaTab.classList.add("active");
    distTab.classList.remove("active");
    heightTab.classList.remove("active");

    containerArea.style.display = "block";
    containerDist.style.display = "none";
    containerHeight.style.display = "none";
  });

  distTab.addEventListener("click", () => {
    distTab.classList.add("active");
    areaTab.classList.remove("active");
    heightTab.classList.remove("active");

    containerArea.style.display = "none";
    containerDist.style.display = "block";
    containerHeight.style.display = "none";
  });

  heightTab.addEventListener("click", () => {
    heightTab.classList.add("active");
    areaTab.classList.remove("active");
    distTab.classList.remove("active");

    containerArea.style.display = "none";
    containerDist.style.display = "none";
    containerHeight.style.display = "block";
  });

  // ───────────────────────────────────────────────────────────────
  // 6) Auto‑stop all measurement modes when the panel is hidden
  // Prevents tools from staying active when the UI is closed
  // ───────────────────────────────────────────────────────────────
  new MutationObserver(() => {
    if (panel.style.display !== "block") {
      areaApi.stop();
      distApi.stop();
      heightApi.stop();
    }
  }).observe(panel, {
    attributes: true,
    attributeFilter: ["style"]
  });
}
