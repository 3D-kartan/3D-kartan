// tools/placement/index.js

import {
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  defined,
  Math as CesiumMath,
  HeadingPitchRoll,
  Transforms,
  Quaternion,
  JulianDate
} from "cesium";

/**
 * A list of available 3D models the user can place in the scene.
 * Each option contains a label and a hard‑coded model URL.
 */
const MODEL_OPTIONS = [
  { label: "Träd - Gran",  src: "models/barrTrad/barrTrad.gltf" },
  { label: "Träd - Björk", src: "models/bjorkTrad/bjorkTrad.gltf" },
  { label: "Träd - Löv",   src: "models/lovTrad/lovTrad.gltf" },
  { label: "Träd - Tall",  src: "models/tallTrad/tallTrad.gltf" },
  { label: "Envåningshus pulpettak",  src: "models/building_1/1-plan_Pulpettak.glb" },
  { label: "Envåningshus sadeltak vinkelhus",  src: "models/building_1/1-plan_Sadeltak_Vinkelhus.glb" },
  { label: "Envåningshus sadeltak",  src: "models/building_1/1-plan_Sadeltak.glb" },
  { label: "1 1/2 våningshus",  src: "models/building_1.5/1,5-plan.glb" },
  { label: "1 3/4 våningshus",  src: "models/building_1.75/1,75-plan.glb" },
  { label: "Tvåvåningshus",  src: "models/building_2/2-plan.glb" },
  { label: "Enkelgarage",  src: "models/garage/Enkelgarage.glb" },
  { label: "Dubbelgarage",  src: "models/garage/Dubbelgarage.glb" },
  {
    label: "Vindkraftverk (h290m, vsp190m)",
    src:   "models/vindkraftverk_h290_vingspann190/Vindkraftverk_h290_vingspann190.gltf"
  }
];

/**
 * Initializes the "Place & Edit Models" tool.
 *
 * Features:
 *  - Place models by clicking on the ground
 *  - Select existing models by clicking them
 *  - Move selected models by dragging
 *  - Rotate selected models using slider/number input
 *  - Scale models before placement
 *  - Remove last or all placed models
 *  - Automatically disables when panel is closed
 *
 * @param {HTMLElement} panel - The tool panel container
 * @param {Viewer} viewer - The Cesium Viewer instance
 */
export default function initPlacement(panel, viewer) {

  // ------------------------------------------------------------
  // Placement handler to not use the global handler
  // ------------------------------------------------------------
  const placementHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);


  const isPanelOpen = () => panel.style.display === "block";

  // ------------------------------------------------------------
  // Panel header
  // ------------------------------------------------------------
  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = "Placera & redigera modeller";
  panel.appendChild(header);

  // ------------------------------------------------------------
  // Panel body
  // ------------------------------------------------------------
  const body = document.createElement("div");
  body.className = "panel-body";
  panel.appendChild(body);

  // ------------------------------------------------------------
  // Row 1: Model selection dropdown
  // ------------------------------------------------------------
  const rowSelect = document.createElement("div");
  rowSelect.className = "row-result";

  const select = document.createElement("select");
  MODEL_OPTIONS.forEach(({ label, src }) => {
    const opt = document.createElement("option");
    opt.value = src;
    opt.textContent = label;
    select.appendChild(opt);
  });

  rowSelect.appendChild(select);
  body.appendChild(rowSelect);

  // ------------------------------------------------------------
  // Row 2: Scale controls (slider + number input)
  // ------------------------------------------------------------
  const rowScale = document.createElement("div");
  rowScale.className = "row-result";

  const scaleLabel = document.createElement("label");
  scaleLabel.textContent = "Skala: ";

  const scaleInput = document.createElement("input");
  scaleInput.type = "range";
  scaleInput.min = "0.1";
  scaleInput.max = "5";
  scaleInput.step = "0.1";
  scaleInput.value = "1";

  const scaleNumber = document.createElement("input");
  scaleNumber.type = "number";
  scaleNumber.min = "0.1";
  scaleNumber.max = "5";
  scaleNumber.step = "0.1";
  scaleNumber.value = "1";
  scaleNumber.style.width = "60px";
  scaleNumber.style.marginLeft = "8px";

  scaleLabel.appendChild(scaleInput);
  scaleLabel.appendChild(scaleNumber);
  rowScale.appendChild(scaleLabel);
  body.appendChild(rowScale);

  // ------------------------------------------------------------
  // Row 3: Placement buttons
  // ------------------------------------------------------------
  const rowButtons = document.createElement("div");
  rowButtons.className = "row-buttons";

  const toggleBtn = document.createElement("button");
  toggleBtn.textContent = "Starta placering";

  const clearAllBtn = document.createElement("button");
  clearAllBtn.textContent = "Rensa alla";

  const clearLastBtn = document.createElement("button");
  clearLastBtn.textContent = "Ta bort sista";

  rowButtons.appendChild(toggleBtn);
  rowButtons.appendChild(clearAllBtn);
  rowButtons.appendChild(clearLastBtn);
  body.appendChild(rowButtons);

  // ------------------------------------------------------------
  // Edit section (selection, move, rotation)
  // ------------------------------------------------------------
  const editSection = document.createElement("div");
  editSection.className = "edit-section";
  body.appendChild(editSection);

  const selectedLabel = document.createElement("div");
  selectedLabel.className = "selected-label";
  selectedLabel.textContent = "Inget valt objekt";
  editSection.appendChild(selectedLabel);

  const moveBtn = document.createElement("button");
  moveBtn.textContent = "Flytta valt";
  moveBtn.disabled = true;
  editSection.appendChild(moveBtn);

  // Rotation controls
  const rowRotate = document.createElement("div");
  rowRotate.className = "row-result";

  const rotateLabel = document.createElement("label");
  rotateLabel.textContent = "Rotation: ";

  const rotateInput = document.createElement("input");
  rotateInput.type = "range";
  rotateInput.min = "0";
  rotateInput.max = "360";
  rotateInput.step = "1";
  rotateInput.value = "0";
  rotateInput.disabled = true;

  const rotateNumber = document.createElement("input");
  rotateNumber.type = "number";
  rotateNumber.min = "0";
  rotateNumber.max = "360";
  rotateNumber.step = "1";
  rotateNumber.value = "0";
  rotateNumber.disabled = true;
  rotateNumber.style.width = "60px";
  rotateNumber.style.marginLeft = "8px";

  rotateLabel.appendChild(rotateInput);
  rotateLabel.appendChild(rotateNumber);
  rowRotate.appendChild(rotateLabel);
  editSection.appendChild(rowRotate);

  // ------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------
  let isPlacing = false;
  let placedEntities = [];
  let selectedEntity = null;
  let editMode = null;
  let currentScale = parseFloat(scaleInput.value);
  let currentHeading = 0;

  // ------------------------------------------------------------
  // Scale syncing
  // ------------------------------------------------------------
  scaleInput.addEventListener("input", () => {
    currentScale = parseFloat(scaleInput.value);
    scaleNumber.value = scaleInput.value;
  });

  scaleNumber.addEventListener("input", () => {
    let v = parseFloat(scaleNumber.value);
    if (isNaN(v)) return;
    v = Math.min(Math.max(v, 0.1), 5);
    scaleInput.value = v;
    scaleNumber.value = v;
    currentScale = v;
  });

  // ------------------------------------------------------------
  // Rotation syncing
  // ------------------------------------------------------------
  rotateInput.addEventListener("input", () => {
    rotateNumber.value = rotateInput.value;
    currentHeading = CesiumMath.toRadians(parseInt(rotateInput.value, 10));
    applyRotation();
  });

  rotateNumber.addEventListener("input", () => {
    let v = parseInt(rotateNumber.value, 10);
    if (isNaN(v)) return;
    v = ((v % 360) + 360) % 360;
    rotateInput.value = v;
    rotateNumber.value = v;
    currentHeading = CesiumMath.toRadians(v);
    applyRotation();
  });

  // ------------------------------------------------------------
  // LEFT_CLICK: place or select model
  // ------------------------------------------------------------
  placementHandler.setInputAction((evt) => {
    if (!isPanelOpen()) return;

    // Place new model
    if (isPlacing) {
      const pos = viewer.scene.pickPosition(evt.position);
      if (!defined(pos)) return;

      const ent = viewer.entities.add({
        position: pos,
        model: { uri: select.value, scale: currentScale }
      });

      placedEntities.push(ent);
      return;
    }

    // Try selecting an existing model
    const picked = viewer.scene.pick(evt.position);

    if (defined(picked) && picked.id && placedEntities.includes(picked.id)) {
      selectedEntity = picked.id;

      selectedLabel.textContent =
        "Valt: " + (picked.id.name || picked.id.id || "modell");

      moveBtn.disabled = false;
      rotateInput.disabled = false;
      rotateNumber.disabled = false;

      // Extract existing heading from orientation quaternion
      const oldQ = selectedEntity.orientation
        ? selectedEntity.orientation.getValue(JulianDate.now())
        : Quaternion.IDENTITY;

      const hprDeg = Math.round(
        CesiumMath.toDegrees(
          HeadingPitchRoll.fromQuaternion(oldQ).heading
        )
      );

      const normalized = ((hprDeg % 360) + 360) % 360;

      rotateInput.value = normalized;
      rotateNumber.value = normalized;

      currentHeading = CesiumMath.toRadians(normalized);
      return;
    }

    // Clicked empty space → clear selection
    clearSelection();
  }, ScreenSpaceEventType.LEFT_CLICK);

  // ------------------------------------------------------------
  // Toggle placement mode
  // ------------------------------------------------------------
  toggleBtn.addEventListener("click", () => {
    if (!isPanelOpen()) return;

    isPlacing = !isPlacing;
    toggleBtn.textContent = isPlacing ? "Avsluta placering" : "Starta placering";
    toggleBtn.style.backgroundColor = isPlacing ? "rgb(26,140,0)" : "";

    if (isPlacing) clearSelection();
  });

  // ------------------------------------------------------------
  // Clear all placed models
  // ------------------------------------------------------------
  clearAllBtn.addEventListener("click", () => {
    placedEntities.forEach(e => viewer.entities.remove(e));
    placedEntities = [];
    clearSelection();
  });

  // ------------------------------------------------------------
  // Remove last placed model
  // ------------------------------------------------------------
  clearLastBtn.addEventListener("click", () => {
    const last = placedEntities.pop();
    if (last) viewer.entities.remove(last);
    clearSelection();
  });

  // ------------------------------------------------------------
  // Move mode
  // ------------------------------------------------------------
  moveBtn.addEventListener("click", () => {
    if (!selectedEntity) return;
    editMode = "move";
    moveBtn.style.backgroundColor = "rgb(26,140,0)";
  });

  // Drag selected model
  placementHandler.setInputAction((mov) => {
    if (editMode !== "move" || !selectedEntity || !isPanelOpen()) return;

    const ray = viewer.camera.getPickRay(mov.endPosition);
    const np = viewer.scene.globe.pick(ray, viewer.scene);
    if (defined(np)) selectedEntity.position = np;
  }, ScreenSpaceEventType.MOUSE_MOVE);

  // End move mode on mouse release
  placementHandler.setInputAction(() => {
    if (editMode === "move") {
      editMode = null;
      moveBtn.style.backgroundColor = "";
    }
  }, ScreenSpaceEventType.LEFT_UP);

  // ------------------------------------------------------------
  // Apply rotation to selected model
  // ------------------------------------------------------------
  function applyRotation() {
    if (!selectedEntity) return;

    const pos = selectedEntity.position.getValue(JulianDate.now());
    const quat = Transforms.headingPitchRollQuaternion(
      pos,
      new HeadingPitchRoll(currentHeading, 0, 0)
    );
    selectedEntity.orientation = quat;
  }

  // ------------------------------------------------------------
  // Clear current selection
  // ------------------------------------------------------------
  function clearSelection() {
    selectedEntity = null;
    selectedLabel.textContent = "Inget valt objekt";
    moveBtn.disabled = true;
    rotateInput.disabled = true;
    rotateInput.value = "0";
    editMode = null;
    moveBtn.style.backgroundColor = "";
  }

  // ------------------------------------------------------------
  // STOP: reset tool state when panel closes
  // ------------------------------------------------------------
  function stop() {
    isPlacing = false;
    editMode = null;

    toggleBtn.textContent = "Starta placering";
    toggleBtn.style.backgroundColor = "";

    moveBtn.style.backgroundColor = "";
    rotateInput.disabled = true;

    clearSelection();
  }

  // ------------------------------------------------------------
  // Auto-stop when panel is hidden
  // ------------------------------------------------------------
  const mo = new MutationObserver(() => {
    if (panel.style.display !== "block") stop();
  });
  mo.observe(panel, { attributes: true, attributeFilter: ["style"] });

  return { stop };
}
