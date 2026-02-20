// src/tools/pedestrian-mode/index.js

import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartesian3,
  Cartographic,
  Math as CesiumMath
} from "cesium";
import "./style.css";

/**
 * Initializes the "Pedestrian Mode" tool.
 *
 * This mode allows the user to:
 *  - click on the ground to place the camera at eye height
 *  - rotate the camera left/right using on‑screen buttons
 *  - adjust eye height dynamically
 *  - temporarily disable Cesium's default camera controls
 *  - hide the UI for an immersive first‑person experience
 *
 * The tool exposes { enter, exit } so external UI (e.g., toolbar.js)
 * can activate or deactivate pedestrian mode.
 *
 * @param {HTMLElement} panel - The tool panel container
 * @param {Viewer} viewer - The Cesium Viewer instance
 */
export default function initPedestrianMode(panel, viewer) {

  // ------------------------------------------------------------
  // Panel header
  // ------------------------------------------------------------
  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = "Fotgängarläge";
  panel.appendChild(header);

  // ------------------------------------------------------------
  // Panel body
  // ------------------------------------------------------------
  const body = document.createElement("div");
  body.className = "panel-body";
  panel.appendChild(body);

  // ------------------------------------------------------------
  // Eye height input
  // ------------------------------------------------------------
  let pedestrianHeight = 1.75;
  let lastGroundCarto = null;

  const heightLabel = document.createElement("label");
  heightLabel.textContent = "Höjd (m): ";
  heightLabel.style.display = "block";
  heightLabel.style.marginBottom = "8px";

  const heightInput = document.createElement("input");
  heightInput.type = "number";
  heightInput.min = "0";
  heightInput.step = "0.1";
  heightInput.value = pedestrianHeight.toString();
  heightInput.style.width = "60px";

  heightLabel.appendChild(heightInput);
  body.appendChild(heightLabel);

  /**
   * Update eye height dynamically.
   * If the user is already placed on the ground, smoothly adjust camera height.
   */
  heightInput.addEventListener("input", () => {
    const v = parseFloat(heightInput.value);
    pedestrianHeight = isNaN(v) ? 0 : v;

    // If already active and positioned, adjust height smoothly
    if (isActive && lastGroundCarto) {
      const dest = Cartesian3.fromRadians(
        lastGroundCarto.longitude,
        lastGroundCarto.latitude,
        lastGroundCarto.height + pedestrianHeight
      );

      viewer.camera.flyTo({
        destination: dest,
        orientation: {
          heading: viewer.camera.heading,
          pitch: 0,
          roll: 0
        },
        duration: 1.0
      });
    }
  });

  // ------------------------------------------------------------
  // Instruction text
  // ------------------------------------------------------------
  const info = document.createElement("div");
  info.className = "tool-instructions";
  info.style.textAlign = "center";
  info.style.marginBottom = "8px";
  info.innerHTML =
    "Zooma in och klicka på marken där du vill placera dig. " +
    "Använd Shift + drag för att vrida huvudet eller pilarna. " +
    "Ange din ögonhöjd ovan innan du klickar.";
  body.appendChild(info);

  // ------------------------------------------------------------
  // Exit button
  // ------------------------------------------------------------
  const exitBtn = document.createElement("button");
  exitBtn.title = "Avsluta fotgängarläge";
  exitBtn.id = "exitPedestrianModeBtn";
  exitBtn.innerText = "Avsluta";
  body.appendChild(exitBtn);

  // ------------------------------------------------------------
  // Rotate left button
  // ------------------------------------------------------------
  const rotateLeftBtn = document.createElement("button");
  rotateLeftBtn.className = "tool-button rotate-left";
  rotateLeftBtn.id = "rotateLeftBtn";
  rotateLeftBtn.title = "Rotera vänster";
  rotateLeftBtn.style.setProperty("--icon", "var(--black-icon-arrow-left)");
  body.appendChild(rotateLeftBtn);

  // ------------------------------------------------------------
  // Rotate right button
  // ------------------------------------------------------------
  const rotateRightBtn = document.createElement("button");
  rotateRightBtn.className = "tool-button rotate-right";
  rotateRightBtn.id = "rotateRightBtn";
  rotateRightBtn.title = "Rotera höger";
  rotateRightBtn.style.setProperty("--icon", "var(--black-icon-arrow-right)");
  body.appendChild(rotateRightBtn);

  // ------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------
  let isActive = false;
  let originalClickAction;
  let rotateInterval = null;
  const rotateSpeed = 0.03;

  // ------------------------------------------------------------
  // Camera rotation helpers
  // ------------------------------------------------------------
  function startRotatingCamera(direction) {
    clearInterval(rotateInterval);
    rotateInterval = setInterval(() => {
      const h = viewer.camera.heading + direction * rotateSpeed;
      viewer.camera.setView({
        orientation: {
          heading: h,
          pitch: viewer.camera.pitch,
          roll: viewer.camera.roll
        }
      });
    }, 10);
  }

  function stopRotatingCamera() {
    clearInterval(rotateInterval);
  }

  // ------------------------------------------------------------
  // Handle ground click while in pedestrian mode
  // ------------------------------------------------------------
  function handlePedestrianClick(event) {
    const ray = viewer.camera.getPickRay(event.position);
    const hit = viewer.scene.pickFromRay(ray);

    if (hit && hit.position) {
      // Save ground position
      const fromCarto = Cartographic.fromCartesian(hit.position);
      lastGroundCarto = fromCarto;

      // Compute destination including eye height
      const destination = Cartesian3.fromRadians(
        fromCarto.longitude,
        fromCarto.latitude,
        fromCarto.height + pedestrianHeight
      );

      // Smooth camera placement
      viewer.camera.flyTo({
        destination,
        orientation: {
          heading: viewer.camera.heading,
          pitch: 0,
          roll: 0
        },
        duration: 2.5
      });
    }
  }

  // ------------------------------------------------------------
  // Enter pedestrian mode
  // ------------------------------------------------------------
  function enter() {
    if (isActive) return;
    isActive = true;

    // Hide UI for immersive mode
    document.getElementById("toolbar").style.display = "none";
    document.getElementById("searchBarContainer").style.display = "none";
    document.getElementById("topRightMenu").style.display = "none";
    document.getElementById("layerMenu").style.display = "none";

    const bottomLeftMenu = document.getElementById("bottomLeftMenu");
    if (bottomLeftMenu) bottomLeftMenu.style.display = "none";

    // Hide all other tool panels
    document.querySelectorAll(".tool-panel").forEach(p => {
      if (p !== panel) p.style.display = "none";
    });

    // Disable default camera controls
    const ctrl = viewer.scene.screenSpaceCameraController;
    ctrl.enableRotate = false;
    ctrl.enableZoom = false;
    ctrl.enableTilt = false;

    // Override LEFT_CLICK behavior
    originalClickAction = viewer.screenSpaceEventHandler.getInputAction(
      ScreenSpaceEventType.LEFT_CLICK
    );

    viewer.screenSpaceEventHandler.setInputAction(
      handlePedestrianClick,
      ScreenSpaceEventType.LEFT_CLICK
    );
  }

  // ------------------------------------------------------------
  // Exit pedestrian mode
  // ------------------------------------------------------------
  function exit() {
    if (!isActive) return;
    isActive = false;

    // Restore UI
    document.getElementById("toolbar").style.display = "";
    document.getElementById("searchBarContainer").style.display = "flex";
    document.getElementById("topRightMenu").style.display = "";
    document.getElementById("layerMenu").style.display = "";

    const bottomLeftMenu = document.getElementById("bottomLeftMenu");
    if (bottomLeftMenu) bottomLeftMenu.style.display = "";

    // Re-enable camera controls
    const ctrl = viewer.scene.screenSpaceCameraController;
    ctrl.enableRotate = true;
    ctrl.enableZoom = true;
    ctrl.enableTilt = true;

    // Restore original LEFT_CLICK action
    viewer.screenSpaceEventHandler.setInputAction(
      originalClickAction,
      ScreenSpaceEventType.LEFT_CLICK
    );

    stopRotatingCamera();
  }

  // ------------------------------------------------------------
  // Button event listeners
  // ------------------------------------------------------------
  exitBtn.addEventListener("click", () => {
    exit();
    panel.style.display = "none";
  });

  rotateLeftBtn.addEventListener("mousedown", () => startRotatingCamera(-1));
  rotateLeftBtn.addEventListener("mouseup", stopRotatingCamera);
  rotateLeftBtn.addEventListener("mouseleave", stopRotatingCamera);
  rotateLeftBtn.addEventListener("touchstart", () => startRotatingCamera(-1));
  rotateLeftBtn.addEventListener("touchend", stopRotatingCamera);
  rotateLeftBtn.addEventListener("contextmenu", e => e.preventDefault());

  rotateRightBtn.addEventListener("mousedown", () => startRotatingCamera(1));
  rotateRightBtn.addEventListener("mouseup", stopRotatingCamera);
  rotateRightBtn.addEventListener("mouseleave", stopRotatingCamera);
  rotateRightBtn.addEventListener("touchstart", () => startRotatingCamera(1));
  rotateRightBtn.addEventListener("touchend", stopRotatingCamera);
  rotateRightBtn.addEventListener("contextmenu", e => e.preventDefault());

  // ------------------------------------------------------------
  // Expose enter/exit so external UI can control the mode
  // ------------------------------------------------------------
  return { enter, exit };
}
