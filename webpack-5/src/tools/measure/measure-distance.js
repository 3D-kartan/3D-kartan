// src/tools/measure/measure-distance/index.js

import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  CallbackProperty,
  Cartesian3,
  Cartesian2,
  Color,
  LabelStyle,
  VerticalOrigin,
  HeightReference
} from "cesium";

/**
 * Initializes the "Measure Distance" tool.
 * Allows the user to:
 *  - click to place vertices
 *  - draw a polyline that updates dynamically
 *  - see a live distance label while drawing
 *  - finalize the line with double‑click
 *  - undo last point with ESC
 *
 * Supports multiple independent measurements in one session.
 *
 * @param {HTMLElement} panel - UI container for the tool
 * @param {Viewer} viewer - Cesium Viewer instance
 */
export default function initMeasureDistance(panel, viewer) {

  // ------------------------------------------------------------
  // UI: Body container
  // ------------------------------------------------------------
  const body = document.createElement("div");
  body.className = "panel-body";
  panel.appendChild(body);

  // ------------------------------------------------------------
  // Row 1: Result text
  // ------------------------------------------------------------
  const resultRow = document.createElement("div");
  resultRow.className = "row-result";

  const resultEl = document.createElement("div");
  resultEl.id = "measure-result";
  resultEl.textContent = "Klicka för att börja mäta";

  resultRow.appendChild(resultEl);
  body.appendChild(resultRow);

  // ------------------------------------------------------------
  // Row 2: Buttons (start/stop + clear)
  // ------------------------------------------------------------
  const btnRow = document.createElement("div");
  btnRow.className = "row-buttons";

  const startBtn = document.createElement("button");
  startBtn.className = "tool-button";
  startBtn.title = "Starta av/på mätläge";
  startBtn.style.setProperty("--icon", "var(--black-icon-edit)");

  const clearBtn = document.createElement("button");
  clearBtn.className = "tool-button";
  clearBtn.title = "Rensa alla mätningar";
  clearBtn.style.setProperty("--icon", "var(--black-icon-delete)");

  btnRow.appendChild(startBtn);
  btnRow.appendChild(clearBtn);
  body.appendChild(btnRow);

  // ------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------
  let isDrawing = false;
  let handler = null;
  let pts = [];
  let floatPt = null;
  let lineEnt = null;
  let dynamicLabel = null;
  let markerEntities = [];

  const measuredLines = [];
  const measuredLabels = [];
  const measuredMarkers = [];

  // ------------------------------------------------------------
  // Helper: create a point marker at each clicked vertex
  // ------------------------------------------------------------
  function createMarker(position) {
    const marker = viewer.entities.add({
      position,
      point: { pixelSize: 6, color: Color.YELLOW }
    });
    markerEntities.push(marker);
    return marker;
  }

  // ------------------------------------------------------------
  // Helper: dynamic polyline for preview
  // ------------------------------------------------------------
  function makeDynamicLine() {
    return new CallbackProperty(() => pts.slice(), false);
  }

  // ------------------------------------------------------------
  // Compute total length of polyline in meters
  // ------------------------------------------------------------
  function computeLength(positions) {
    let sum = 0;
    for (let i = 1; i < positions.length; i++) {
      sum += Cartesian3.distance(positions[i - 1], positions[i]);
    }
    return sum;
  }

  // ------------------------------------------------------------
  // Finalize the current line and create permanent entities
  // ------------------------------------------------------------
  function finalizeLine() {
    // Remove temporary helpers
    if (floatPt) { viewer.entities.remove(floatPt); floatPt = null; }
    if (lineEnt) { viewer.entities.remove(lineEnt); lineEnt = null; }
    if (dynamicLabel) { viewer.entities.remove(dynamicLabel); dynamicLabel = null; }

    // Create permanent polyline
    const line = viewer.entities.add({
      polyline: {
        positions: pts.slice(),
        width: 3,
        material: Color.RED,
        clampToGround: true
      }
    });
    measuredLines.push(line);

    // Store markers belonging to this measurement
    measuredMarkers.push([...markerEntities]);

    // Create final label at last point
    const length = computeLength(pts);
    const last = pts[pts.length - 1];

    const label = viewer.entities.add({
      position: last,
      label: {
        text: `${length.toFixed(2)} m`,
        font: "bold 16px sans-serif",
        fillColor: Color.BLACK,
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.WHITE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -10),
        heightReference: HeightReference.CLAMP_TO_GROUND
      }
    });
    measuredLabels.push(label);

    // Reset for next measurement
    pts = [];
    markerEntities = [];
  }

  // ------------------------------------------------------------
  // Toggle drawing mode
  // ------------------------------------------------------------
  function toggleDrawing() {
    if (isDrawing) return stopDrawing();
    return startDrawing();
  }

  // ------------------------------------------------------------
  // Start drawing mode
  // ------------------------------------------------------------
  function startDrawing() {
    isDrawing = true;
    startBtn.style.setProperty("--icon", "var(--black-icon-edit-off)");
    resultEl.textContent = "Klicka för att lägga punkter, dubbelklick för att färdigställa";

    handler = new ScreenSpaceEventHandler(viewer.canvas);
    pts = [];
    floatPt = null;
    lineEnt = null;
    markerEntities = [];

    // LEFT CLICK: add vertex
    handler.setInputAction(evt => {
      const pos = viewer.scene.pickPosition(evt.position);
      if (!defined(pos)) return;

      // First click initializes floating point + dynamic line + label
      if (pts.length === 0) {
        pts.push(pos);
        pts.push(pos);

        floatPt = createMarker(pos);

        lineEnt = viewer.entities.add({
          polyline: {
            positions: makeDynamicLine(),
            width: 3,
            material: Color.YELLOW,
            clampToGround: true
          }
        });

        dynamicLabel = viewer.entities.add({
          position: pos,
          label: {
            text: "0 m",
            font: "bold 14px sans-serif",
            fillColor: Color.BLACK,
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Color.WHITE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -10),
            heightReference: HeightReference.CLAMP_TO_GROUND
          }
        });

      } else {
        // Subsequent clicks: convert floating point to fixed, add new floating point
        pts[pts.length - 1] = pos;
        floatPt = createMarker(pos);
        pts.push(pos);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    // MOUSE MOVE: update floating point + dynamic label
    handler.setInputAction(evt => {
      if (!floatPt) return;

      const pos = viewer.scene.pickPosition(evt.endPosition);
      if (!defined(pos)) return;

      floatPt.position.setValue(pos);
      pts[pts.length - 1] = pos;

      if (dynamicLabel) {
        const length = computeLength(pts);
        dynamicLabel.position.setValue(pos);
        dynamicLabel.label.text = `${length.toFixed(2)} m`;
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // DOUBLE CLICK: finalize line
    handler.setInputAction(() => {
      if (pts.length < 2) return;
      finalizeLine();
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // ESC: undo last point
    window.addEventListener("keydown", escHandler);
  }

  // ------------------------------------------------------------
  // Stop drawing mode
  // ------------------------------------------------------------
  function stopDrawing() {
    isDrawing = false;
    startBtn.style.setProperty("--icon", "var(--black-icon-edit)");

    handler && handler.destroy();
    handler = null;

    window.removeEventListener("keydown", escHandler);

    if (dynamicLabel) { viewer.entities.remove(dynamicLabel); dynamicLabel = null; }

    markerEntities.forEach(m => viewer.entities.remove(m));
    markerEntities = [];

    pts = [];
  }

  // ------------------------------------------------------------
  // ESC handler: remove last vertex while drawing
  // ------------------------------------------------------------
  function escHandler(evt) {
    if (evt.key !== "Escape" || !isDrawing) return;

    if (pts.length > 0) {
      pts.pop();

      const lastMarker = markerEntities.pop();
      if (lastMarker) viewer.entities.remove(lastMarker);

      // Update dynamic label
      if (dynamicLabel) {
        if (pts.length > 0) {
          const length = computeLength(pts);
          dynamicLabel.position.setValue(pts[pts.length - 1]);
          dynamicLabel.label.text = `${length.toFixed(2)} m`;
        } else {
          dynamicLabel.label.text = "0 m";
        }
      }

      // Hide dynamic line if fewer than 2 points remain
      if (pts.length < 2 && lineEnt) {
        lineEnt.polyline.show = false;
      }
    }
  }

  // ------------------------------------------------------------
  // Clear all measured lines, labels, and markers
  // ------------------------------------------------------------
  function clearAll() {
    measuredLines.forEach(e => viewer.entities.remove(e));
    measuredLabels.forEach(e => viewer.entities.remove(e));

    measuredMarkers.forEach(markerList => {
      markerList.forEach(m => viewer.entities.remove(m));
    });

    measuredLines.length = 0;
    measuredLabels.length = 0;

    stopDrawing();
  }

  // ------------------------------------------------------------
  // Bind buttons
  // ------------------------------------------------------------
  startBtn.addEventListener("click", toggleDrawing);
  clearBtn.addEventListener("click", clearAll);

  // ------------------------------------------------------------
  // Stop drawing if panel is hidden
  // ------------------------------------------------------------
  new MutationObserver(() => {
    if (panel.style.display !== "block" && isDrawing) {
      stopDrawing();
    }
  }).observe(panel, { attributes: true, attributeFilter: ["style"] });

  // Expose stop() to parent tool
  return {
    stop: stopDrawing
  };
}
