// src/tools/hide-buildings/index.js

import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined
} from "cesium";
import "./style.css";

/**
 * Initializes the "Hide Buildings" tool inside a panel window.
 * Allows the user to middle‑click buildings (3D Tiles features) to hide them,
 * while ignoring user‑created Cesium Entities. A restore button resets all.
 *
 * @param {HTMLElement} panel - The UI container for the tool
 * @param {Viewer} viewer - The Cesium Viewer instance
 */
export default function initHideBuildings(panel, viewer) {
  // ------------------------------------------------------------
  // 1) Panel header
  // ------------------------------------------------------------
  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = "Göm byggnader";
  panel.appendChild(header);

  // ------------------------------------------------------------
  // 2) Panel body
  // ------------------------------------------------------------
  const body = document.createElement("div");
  body.className = "panel-body";
  panel.appendChild(body);

  // ------------------------------------------------------------
  // 3) Instruction text
  // ------------------------------------------------------------
  const instructions = document.createElement("div");
  instructions.className = "tool-instructions";
  instructions.textContent = "Mittenklicka (mus-skrollen) på byggnader för att gömma dem";
  body.appendChild(instructions);

  // ------------------------------------------------------------
  // 4) Restore button (initially disabled)
  // ------------------------------------------------------------
  const restoreBtn = document.createElement("button");
  restoreBtn.className = "tool-button";
  restoreBtn.title = "Återställ byggnader";
  restoreBtn.style.setProperty("--icon", "var(--black-icon-visibility)");
  restoreBtn.disabled = true;
  body.appendChild(restoreBtn);

  // ------------------------------------------------------------
  // 5) Counter showing how many buildings are hidden
  // ------------------------------------------------------------
  const counter = document.createElement("div");
  counter.className = "tool-counter";
  counter.textContent = "Antal gömda byggnader: 0";
  counter.style.display = "none";
  counter.style.marginTop = "8px";
  body.appendChild(counter);

  // ------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------
  const scene = viewer.scene;
  const hiddenFeatures = []; // Stores references to hidden Cesium3DTileFeatures

  /**
   * Updates the UI (counter + restore button state)
   */
  function updateUI() {
    const n = hiddenFeatures.length;
    counter.textContent = `Antal gömda byggnader: ${n}`;
    counter.style.display = n > 0 ? "block" : "none";
    restoreBtn.disabled = n === 0;
  }

  // ------------------------------------------------------------
  // 6) Middle‑click to hide buildings
  // ------------------------------------------------------------
  const handler = new ScreenSpaceEventHandler(viewer.canvas);

  handler.setInputAction(movement => {
    // Only active when the panel is visible
    if (panel.style.display !== "block") return;

    const picked = scene.pick(movement.position);
    if (!defined(picked) || picked.show === false) return;

    // Ignore user‑created Entities (viewer.entities)
    if (picked.id && viewer.entities.contains(picked.id)) {
      return;
    }

    // Hide the picked feature (typically a Cesium3DTileFeature)
    picked.show = false;
    hiddenFeatures.push(picked);
    updateUI();
  }, ScreenSpaceEventType.MIDDLE_CLICK);

  // ------------------------------------------------------------
  // 7) Restore all hidden buildings
  // ------------------------------------------------------------
  restoreBtn.addEventListener("click", () => {
    hiddenFeatures.forEach(f => (f.show = true));
    hiddenFeatures.length = 0;
    updateUI();
  });

  // Initial UI state
  restoreBtn.disabled = true;
  counter.style.display = "none";
}
