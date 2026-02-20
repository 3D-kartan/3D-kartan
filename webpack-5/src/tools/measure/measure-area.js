// src/tools/measure/measure-area/index.js

import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  CallbackProperty,
  PolygonHierarchy,
  Cartographic,
  Cartesian3,
  Cartesian2,
  Color,
  Ellipsoid,
  LabelStyle,
  VerticalOrigin,
  HeightReference
} from "cesium";

/**
 * Initializes the "Measure Area" tool.
 * Allows the user to draw a polygon on the globe and calculates:
 *  - the polygon area (m²)
 *  - a centroid label
 *  - a dynamic preview area while drawing
 *
 * The tool supports:
 *  - ESC to undo last point
 *  - double‑click to finalize polygon
 *  - multiple polygons in one session
 *
 * @param {HTMLElement} panel - Container where the tool UI is rendered
 * @param {Viewer} viewer - The Cesium Viewer instance
 */
export default function initMeasureArea(panel, viewer) {

  // ------------------------------------------------------------
  // UI: body container
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
  let isDrawing        = false;
  let handler          = null;
  let pts              = [];
  let floatPt          = null;
  let shapeEnt         = null;
  let dynamicLabel     = null;
  let markerEntities   = [];
  const measuredPolys  = [];
  const measuredLabels = [];

  // ------------------------------------------------------------
  // Helper: create a point marker for each clicked vertex
  // ------------------------------------------------------------
  function createMarker(position) {
    return viewer.entities.add({
      position,
      point: { pixelSize: 6, color: Color.YELLOW }
    });
  }

  // ------------------------------------------------------------
  // Helper: dynamic polygon hierarchy for the preview shape
  // ------------------------------------------------------------
  function makeDynamicHierarchy() {
    return new CallbackProperty(() => new PolygonHierarchy(pts), false);
  }

  // ------------------------------------------------------------
  // Compute polygon area (m²) using ellipsoidal approximation
  // ------------------------------------------------------------
  function computeArea(positions) {
    const ellipsoid = viewer.scene.globe.ellipsoid;
    const cartos = positions.map(p =>
      Cartographic.fromCartesian(p, ellipsoid)
    );

    const R = ellipsoid.maximumRadius;
    let sum = 0;

    // Spherical excess approximation
    for (let i = 0, n = cartos.length; i < n; i++) {
      const c1 = cartos[i];
      const c2 = cartos[(i + 1) % n];
      sum += (c2.longitude - c1.longitude) *
             (2 + Math.sin(c1.latitude) + Math.sin(c2.latitude));
    }

    return Math.abs(sum * R * R / 2);
  }

  // ------------------------------------------------------------
  // Finalize polygon: remove temporary objects, create permanent polygon + label
  // ------------------------------------------------------------
  function finalizePolygon() {
    // Remove temporary drawing helpers
    if (floatPt)      { viewer.entities.remove(floatPt); floatPt = null; }
    if (shapeEnt)     { viewer.entities.remove(shapeEnt); shapeEnt = null; }
    if (dynamicLabel) { viewer.entities.remove(dynamicLabel); dynamicLabel = null; }

    pts.pop(); // Remove duplicated last point

    // Create permanent polygon entity
    const poly = viewer.entities.add({
      polygon: {
        hierarchy: positionsCopy(),
        material: Color.BLUE.withAlpha(0.4)
      }
    });
    measuredPolys.push(poly);

    // Compute area + centroid
    const area = computeArea(positionsCopy());
    const centroid = computeCentroid(positionsCopy());

    // Create permanent label at centroid
    const labelEnt = viewer.entities.add({
      position: centroid,
      label: {
        text: `${area.toFixed(1)} m²`,
        font: "bold 16px sans-serif",
        fillColor: Color.BLACK,
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.WHITE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -10),
        heightReference: HeightReference.CLAMP_TO_GROUND
      }
    });
    measuredLabels.push(labelEnt);

    // Reset for next polygon
    pts = [];
  }

  // ------------------------------------------------------------
  // Helper: deep copy of positions array
  // ------------------------------------------------------------
  function positionsCopy() {
    return pts.map(p => Cartesian3.clone(p));
  }

  // ------------------------------------------------------------
  // Compute centroid by averaging Cartographic coordinates
  // ------------------------------------------------------------
  function computeCentroid(positions) {
    const ellipsoid = viewer.scene.globe.ellipsoid;
    const cartos = positions.map(p =>
      Cartographic.fromCartesian(p, ellipsoid)
    );

    const n = cartos.length;
    let sumLon = 0, sumLat = 0, sumH = 0;

    cartos.forEach(c => {
      sumLon += c.longitude;
      sumLat += c.latitude;
      sumH   += c.height;
    });

    const avgLon = sumLon / n;
    const avgLat = sumLat / n;
    let avgH = sumH / n;

    // Ensure label is above ground
    if (avgH < 0) avgH = 0;
    avgH += 2;

    return Cartesian3.fromRadians(avgLon, avgLat, avgH);
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
    resultEl.textContent = "Klicka minst 3 gånger och dubbelklicka för att färdigställa";

    handler = new ScreenSpaceEventHandler(viewer.canvas);
    pts = [];
    floatPt = null;
    shapeEnt = null;

    // LEFT CLICK: add vertex
    handler.setInputAction(evt => {
      const pos = viewer.scene.pickPosition(evt.position);
      if (!defined(pos)) return;

      // First point initializes floating point + dynamic polygon + dynamic label
      if (pts.length === 0) {
        floatPt = createMarker(pos);
        pts.push(pos);

        shapeEnt = viewer.entities.add({
          polygon: {
            hierarchy: makeDynamicHierarchy(),
            material: Color.YELLOW.withAlpha(0.3)
          }
        });

        dynamicLabel = viewer.entities.add({
          position: pos,
          label: {
            text: "0 m²",
            font: "bold 14px sans-serif",
            fillColor: Color.BLACK,
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Color.WHITE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -10),
            heightReference: HeightReference.CLAMP_TO_GROUND
          }
        });
      }

      pts.push(pos);
      const marker = createMarker(pos);
      markerEntities.push(marker);

      if (pts.length >= 3) shapeEnt.polygon.show = true;
    }, ScreenSpaceEventType.LEFT_CLICK);

    // MOUSE MOVE: update floating point + dynamic area label
    handler.setInputAction(evt => {
      if (!floatPt) return;

      const pos = viewer.scene.pickPosition(evt.endPosition);
      if (!defined(pos)) return;

      floatPt.position.setValue(pos);
      pts.pop();
      pts.push(pos);

      // Update dynamic area label
      if (pts.length >= 3 && dynamicLabel) {
        const area = computeArea(positionsCopy());
        const centroid = computeCentroid(positionsCopy());
        dynamicLabel.position.setValue(centroid);
        dynamicLabel.label.text = `${area.toFixed(1)} m²`;
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // DOUBLE CLICK: finalize polygon (but keep drawing mode active)
    handler.setInputAction(() => {
      if (pts.length < 3) return;

      finalizePolygon();

      // Remove temporary markers
      markerEntities.forEach(m => viewer.entities.remove(m));
      markerEntities = [];

      pts = [];
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
    resultEl.textContent = "Klicka för att börja mäta";

    handler && handler.destroy();
    handler = null;

    window.removeEventListener("keydown", escHandler);

    // Remove dynamic label
    if (dynamicLabel) {
      viewer.entities.remove(dynamicLabel);
      dynamicLabel = null;
    }

    // Remove floating point
    if (floatPt) {
      viewer.entities.remove(floatPt);
      floatPt = null;
    }

    // Remove dynamic polygon
    if (shapeEnt) {
      viewer.entities.remove(shapeEnt);
      shapeEnt = null;
    }

    // Remove temporary markers
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

      if (shapeEnt && pts.length < 3) {
        shapeEnt.polygon.show = false;
      }

      // Update dynamic label
      if (dynamicLabel) {
        if (pts.length >= 3) {
          const area = computeArea(positionsCopy());
          const centroid = computeCentroid(positionsCopy());
          dynamicLabel.position.setValue(centroid);
          dynamicLabel.label.text = `${area.toFixed(1)} m²`;
        } else {
          dynamicLabel.label.text = "0 m²";
        }
      }
    }
  }

  // ------------------------------------------------------------
  // Clear all measured polygons + labels
  // ------------------------------------------------------------
  function clearAll() {
    measuredPolys.forEach(e => viewer.entities.remove(e));
    measuredLabels.forEach(e => viewer.entities.remove(e));

    measuredPolys.length = 0;
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
