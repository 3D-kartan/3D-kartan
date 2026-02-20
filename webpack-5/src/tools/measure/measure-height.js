// src/tools/measure/measure-height/index.js

import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  Cartesian3,
  Cartesian2,
  Color,
  LabelStyle,
  VerticalOrigin,
  HeightReference,
  Cartographic,
  Ellipsoid,
  sampleTerrainMostDetailed
} from "cesium";

/**
 * Initializes the "Measure Height" tool.
 *
 * This tool lets the user:
 *  - click two points in the scene
 *  - measure vertical height difference (ΔH)
 *  - measure horizontal distance (H)
 *  - measure diagonal distance (D)
 *  - visualize all three with colored lines:
 *      RED   = diagonal
 *      BLUE  = horizontal projection
 *      GREEN = vertical segment
 *  - show labels for each measurement
 *
 * Supports multiple measurements and clearing all results.
 *
 * @param {HTMLElement} panel - UI container for the tool
 * @param {Viewer} viewer - Cesium Viewer instance
 */
export default function initMeasureHeight(panel, viewer) {

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
  startBtn.title = "Starta/avsluta höjdmätning";
  startBtn.style.setProperty("--icon", "var(--black-icon-edit)");

  const clearBtn = document.createElement("button");
  clearBtn.className = "tool-button";
  clearBtn.title = "Rensa höjdmätningar";
  clearBtn.style.setProperty("--icon", "var(--black-icon-delete)");

  btnRow.appendChild(startBtn);
  btnRow.appendChild(clearBtn);
  body.appendChild(btnRow);

  // ------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------
  let isDrawing      = false;
  let handler        = null;
  let pts            = [];
  let tempMarkerEnts = [];
  let diagEnt        = null;
  let horizEnt       = null;
  let vertEnt        = null;
  let labelEnt       = null;
  let labelDiag, labelHoriz, labelVert;

  const measuredMarkers = [];
  const measuredLines   = [];
  const measuredLabels  = [];

  // ------------------------------------------------------------
  // Helper: pick world position from screen coordinates
  // Falls back to ellipsoid if pickPosition fails
  // ------------------------------------------------------------
  function pickWorldPosition(windowPos) {
    if (!defined(windowPos)) return;

    let pos = viewer.scene.pickPosition(windowPos);
    if (defined(pos)) return pos;

    return viewer.camera.pickEllipsoid(
      windowPos,
      viewer.scene.globe.ellipsoid
    );
  }

  // ------------------------------------------------------------
  // Helper: compute horizontal, vertical, and diagonal distances
  // ------------------------------------------------------------
  function computeMetrics(p1, p2) {
    const ellipsoid = viewer.scene.globe.ellipsoid;

    const c1 = Cartographic.fromCartesian(p1, ellipsoid);
    const c2 = Cartographic.fromCartesian(p2, ellipsoid);

    const heightDiff = Math.abs(c2.height - c1.height);

    // Project p2 onto p1's height level
    const proj = Cartesian3.fromRadians(
      c2.longitude, c2.latitude, c1.height, ellipsoid
    );

    const horizontal = Cartesian3.distance(p1, proj);
    const diagonal   = Cartesian3.distance(p1, p2);

    return { horizontal, heightDiff, diagonal, proj };
  }

  // ------------------------------------------------------------
  // Finalize measurement: create permanent lines + labels
  // ------------------------------------------------------------
  function finalizeHeight() {
    // Remove temporary markers
    tempMarkerEnts.forEach(m => viewer.entities.remove(m));
    tempMarkerEnts = [];

    const [p1, p2] = pts;
    const { horizontal, heightDiff, diagonal, proj } = computeMetrics(p1, p2);

    // Create permanent lines
    diagEnt = viewer.entities.add({
      polyline: {
        positions: [p1, p2],
        width: 2,
        material: Color.RED
      }
    });

    horizEnt = viewer.entities.add({
      polyline: {
        positions: [p1, proj],
        width: 2,
        material: Color.BLUE
      }
    });

    vertEnt = viewer.entities.add({
      polyline: {
        positions: [proj, p2],
        width: 2,
        material: Color.GREEN
      }
    });

    // Midpoints for label placement
    const midDiag  = new Cartesian3();
    const midHoriz = new Cartesian3();
    const midVert  = new Cartesian3();

    Cartesian3.midpoint(p1, p2, midDiag);
    Cartesian3.midpoint(p1, proj, midHoriz);
    Cartesian3.midpoint(proj, p2, midVert);

    // Create labels (no heightReference so they float at line height)
    labelDiag = viewer.entities.add({
      position: midDiag,
      label: {
        text: `${diagonal.toFixed(2)} m`,
        font: "bold 14px sans-serif",
        fillColor: Color.WHITE,
        style: LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: new Color(0.165, 0.165, 0.165, 0.8),
        outlineColor: Color.BLACK,
        verticalOrigin: VerticalOrigin.CENTER,
        pixelOffset: new Cartesian2(0, -10),
        heightReference: HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });

    labelHoriz = viewer.entities.add({
      position: midHoriz,
      label: {
        text: `${horizontal.toFixed(2)} m`,
        font: "bold 14px sans-serif",
        fillColor: Color.WHITE,
        style: LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: new Color(0.165, 0.165, 0.165, 0.8),
        outlineColor: Color.BLACK,
        verticalOrigin: VerticalOrigin.CENTER,
        pixelOffset: new Cartesian2(0, -10),
        heightReference: HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });

    labelVert = viewer.entities.add({
      position: midVert,
      label: {
        text: `${heightDiff.toFixed(2)} m`,
        font: "bold 14px sans-serif",
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: new Color(0.165, 0.165, 0.165, 0.8),
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        verticalOrigin: VerticalOrigin.CENTER,
        pixelOffset: new Cartesian2(10, 0),
        heightReference: HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });

    // Store permanent entities
    measuredLines.push(diagEnt, horizEnt, vertEnt);
    measuredLabels.push(labelDiag, labelHoriz, labelVert);

    // Reset for next measurement
    pts = [];
  }

  // ------------------------------------------------------------
  // Start drawing mode
  // ------------------------------------------------------------
  function startDrawing() {
    isDrawing = true;
    startBtn.style.setProperty("--icon", "var(--black-icon-edit-off)");
    resultEl.textContent = "Klicka en gång för startpunkt och en gång för slutpunkt";

    handler = new ScreenSpaceEventHandler(viewer.canvas);
    pts = [];
    tempMarkerEnts = [];

    // LEFT CLICK: add point
    handler.setInputAction(evt => {
      const pos = pickWorldPosition(evt.position);
      if (!defined(pos)) return;

      pts.push(pos);

      const m = viewer.entities.add({
        position: pos,
        point: { pixelSize: 6, color: Color.YELLOW }
      });
      tempMarkerEnts.push(m);

      // When two points exist → finalize measurement
      if (pts.length === 2) {
        finalizeHeight();
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  // ------------------------------------------------------------
  // Stop drawing mode
  // ------------------------------------------------------------
  function stopDrawing() {
    isDrawing = false;
    startBtn.style.setProperty("--icon", "var(--black-icon-edit)");

    handler?.destroy();
    handler = null;

    // Remove temporary markers
    tempMarkerEnts.forEach(m => viewer.entities.remove(m));
    tempMarkerEnts = [];

    pts = [];
  }

  // ------------------------------------------------------------
  // Clear all measurements
  // ------------------------------------------------------------
  function clearAll() {
    stopDrawing();

    measuredLines.forEach(e => viewer.entities.remove(e));
    measuredLines.length = 0;

    measuredLabels.forEach(e => viewer.entities.remove(e));
    measuredLabels.length = 0;
  }

  // ------------------------------------------------------------
  // Bind UI events
  // ------------------------------------------------------------
  startBtn.addEventListener("click", () => {
    isDrawing ? stopDrawing() : startDrawing();
  });

  clearBtn.addEventListener("click", clearAll);

  // ------------------------------------------------------------
  // Stop drawing if panel is hidden
  // ------------------------------------------------------------
  new MutationObserver(() => {
    if (panel.style.display !== "block" && isDrawing) {
      stopDrawing();
    }
  }).observe(panel, {
    attributes: true,
    attributeFilter: ["style"]
  });

  // Expose stop() to parent tool
  return {
    stop: stopDrawing
  };
}
