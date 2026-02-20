// src/tools/draw-3d/index.js

import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  CallbackProperty,
  PolygonHierarchy,
  Cartographic,
  Color,
  HeightReference,
  ShadowMode
} from "cesium";
import "./style.css";

/**
 * Initializes the "Draw 3D Polygons" tool.
 * This tool allows the user to:
 *  - interactively draw a polygon on the ground
 *  - extrude it into a 3D volume based on a user‑defined height
 *  - delete all created 3D polygons
 *
 * @param {HTMLElement} panel - The UI container where the tool UI is rendered
 * @param {Viewer} viewer - The Cesium Viewer instance
 */
export default function initDraw3D(panel, viewer) {
  // ------------------------------------------------------------
  // 1) Panel header
  // ------------------------------------------------------------
  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = "Rita 3D-polygoner";
  panel.appendChild(header);

  // ------------------------------------------------------------
  // 2) Panel body
  // ------------------------------------------------------------
  const body = document.createElement("div");
  body.className = "panel-body";
  panel.appendChild(body);

  // ------------------------------------------------------------
  // 3) Height input row
  // ------------------------------------------------------------
  const inputRow = document.createElement("div");
  inputRow.className = "row-input";

  const heightLabel = document.createElement("label");
  heightLabel.textContent = "Höjd (m): ";

  const heightInput = document.createElement("input");
  heightInput.type = "number";
  heightInput.min = "0";
  heightInput.step = "1";
  heightInput.value = "10";

  heightLabel.appendChild(heightInput);
  inputRow.appendChild(heightLabel);
  body.appendChild(inputRow);

  // ------------------------------------------------------------
  // 4) Button row (start drawing / clear polygons)
  // ------------------------------------------------------------
  const btnRow = document.createElement("div");
  btnRow.className = "row-buttons";

  // Start drawing button
  const startBtn = document.createElement("button");
  startBtn.className = "tool-button";
  startBtn.title = "Rita 3D-polygoner";
  startBtn.style.setProperty("--icon", "var(--black-icon-edit)");

  // Clear polygons button
  const clearBtn = document.createElement("button");
  clearBtn.className = "tool-button";
  clearBtn.title = "Radera 3D-polygoner";
  clearBtn.style.setProperty("--icon", "var(--black-icon-delete)");

  btnRow.appendChild(startBtn);
  btnRow.appendChild(clearBtn);
  body.appendChild(btnRow);

  // ------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------
  let isDrawing = false;
  let drawingHandler;
  let activeShapePoints = [];
  let floatingPoint;
  let activeShape;
  const createdPoints = [];
  const drawnPolygons = [];

  // ------------------------------------------------------------
  // Helper: create a visible point entity at a clicked position
  // ------------------------------------------------------------
  function createPoint(position) {
    const e = viewer.entities.add({
      position,
      point: {
        pixelSize: 5,
        color: Color.YELLOW,
        heightReference: HeightReference.CLAMP_TO_GROUND
      }
    });
    createdPoints.push(e);
    return e;
  }

  // ------------------------------------------------------------
  // Helper: dynamic polygon hierarchy for the preview shape
  // ------------------------------------------------------------
  function shapeCallback() {
    return new CallbackProperty(
      () => new PolygonHierarchy(activeShapePoints),
      false
    );
  }

  // ------------------------------------------------------------
  // Helper: create the temporary preview polygon entity
  // ------------------------------------------------------------
  function drawShapeEntity() {
    return viewer.entities.add({
      polygon: {
        hierarchy: shapeCallback(),
        material: Color.YELLOW.withAlpha(0.5),
        show: false
      }
    });
  }

  // ------------------------------------------------------------
  // Helper: create the final extruded 3D polygon
  // ------------------------------------------------------------
  function extrudePolygon(positions) {
    // Convert to Cartographic to determine ground height
    const cartes = positions.map(p => Cartographic.fromCartesian(p));
    const minH = Math.min(...cartes.map(c => c.height));
    const extra = parseFloat(heightInput.value) || 0;

    const e = viewer.entities.add({
      polygon: {
        hierarchy: positions,
        extrudedHeight: minH + extra,
        material: Color.GREY.withAlpha(0.7),
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        shadows: ShadowMode.ENABLED
      },
      is3dPolygon: true
    });

    drawnPolygons.push(e);
  }

  // ------------------------------------------------------------
  // Start drawing mode
  // ------------------------------------------------------------
  function startDrawing() {
    if (isDrawing) return;
    isDrawing = true;

    // Switch icon to "edit-off"
    startBtn.style.setProperty("--icon", "var(--black-icon-edit-off)");

    drawingHandler = new ScreenSpaceEventHandler(viewer.canvas);
    activeShapePoints.length = 0;
    createdPoints.length = 0;

    // LEFT_CLICK: add a vertex
    drawingHandler.setInputAction(evt => {
      const pos = viewer.scene.pickPosition(evt.position);
      if (!defined(pos)) return;

      // First point initializes the floating preview
      if (activeShapePoints.length === 0) {
        floatingPoint = createPoint(pos);
        activeShapePoints.push(pos);
        activeShape = drawShapeEntity();
      }

      activeShapePoints.push(pos);
      createPoint(pos);

      // Show polygon only when at least 3 points exist
      if (activeShapePoints.length >= 3) {
        activeShape.polygon.show = true;
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    // MOUSE_MOVE: update the floating preview point
    drawingHandler.setInputAction(evt => {
      if (!floatingPoint) return;

      const pos = viewer.scene.pickPosition(evt.endPosition);
      if (!defined(pos)) return;

      floatingPoint.position.setValue(pos);
      activeShapePoints.pop();
      activeShapePoints.push(pos);

      activeShape.polygon.show = activeShapePoints.length >= 3;
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // LEFT_DOUBLE_CLICK: finalize polygon
    drawingHandler.setInputAction(() => {
      if (activeShapePoints.length < 3) return;

      // Remove floating preview point
      activeShapePoints.pop();
      if (floatingPoint) {
        viewer.entities.remove(floatingPoint);
        floatingPoint = undefined;
      }

      // Remove preview polygon
      if (activeShape) {
        viewer.entities.remove(activeShape);
        activeShape = undefined;
      }

      // Remove temporary point markers
      createdPoints.forEach(pt => viewer.entities.remove(pt));
      createdPoints.length = 0;

      // Create final extruded polygon
      extrudePolygon(activeShapePoints);

      activeShapePoints = [];
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // ESC: undo last point
    window.addEventListener("keydown", escHandler);
  }

  // ------------------------------------------------------------
  // Stop drawing mode (cancel)
  // ------------------------------------------------------------
  function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;

    // Restore icon
    startBtn.style.setProperty("--icon", "var(--black-icon-edit)");

    if (drawingHandler) {
      drawingHandler.destroy();
      drawingHandler = undefined;
    }

    window.removeEventListener("keydown", escHandler);

    // Clean up temporary entities
    if (activeShape) {
      viewer.entities.remove(activeShape);
      activeShape = undefined;
    }
    if (floatingPoint) {
      viewer.entities.remove(floatingPoint);
      floatingPoint = undefined;
    }

    createdPoints.forEach(pt => viewer.entities.remove(pt));
    createdPoints.length = 0;
    activeShapePoints = [];
  }

  // ------------------------------------------------------------
  // ESC handler: remove last point while drawing
  // ------------------------------------------------------------
  function escHandler(event) {
    if (event.key !== "Escape" || !isDrawing) return;

    if (activeShapePoints.length > 1) {
      activeShapePoints.pop();
      const pt = createdPoints.pop();
      viewer.entities.remove(pt);

      if (activeShape && activeShapePoints.length < 3) {
        activeShape.polygon.show = false;
      }
    }
  }

  // ------------------------------------------------------------
  // Delete all created 3D polygons
  // ------------------------------------------------------------
  function clearAllPolygons() {
    drawnPolygons.forEach(p => viewer.entities.remove(p));
    drawnPolygons.length = 0;
  }

  // ------------------------------------------------------------
  // Button events
  // ------------------------------------------------------------
  startBtn.addEventListener("click", () => {
    if (isDrawing) stopDrawing();
    else startDrawing();
  });

  clearBtn.addEventListener("click", clearAllPolygons);

  // ------------------------------------------------------------
  // Auto-stop drawing if the panel is hidden
  // ------------------------------------------------------------
  const mo = new MutationObserver(() => {
    if (panel.style.display !== "block" && isDrawing) {
      stopDrawing();
    }
  });

  mo.observe(panel, { attributes: true, attributeFilter: ["style"] });
}
