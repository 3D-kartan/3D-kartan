// src/tools/measure/measure-distance/index.js

import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  CallbackProperty,
  defined,
  Cartesian3,
  Cartesian2,
  Color,
  LabelStyle,
  VerticalOrigin,
  HeightReference
} from "cesium";

/**
 * Initialize the distance measurement tool.
 *
 * Features:
 * - Click to add points
 * - Move mouse to preview the current segment
 * - Double click to finalize the measurement
 * - Press ESC to undo the latest fixed point
 * - Clear all saved measurements
 *
 * Extra behavior:
 * - Measurement entities do not trigger info selection while drawing
 * - Final point markers store segment metadata
 * - Clicking a final point highlights:
 *   - the point itself
 *   - the segment ending at that point
 * - The first point only highlights itself, never a segment
 *
 * @param {HTMLElement} panel
 * @param {import("cesium").Viewer} viewer
 */
export default function initMeasureDistance(panel, viewer) {
  // ------------------------------------------------------------
  // UI: main content container
  // ------------------------------------------------------------
  const body = document.createElement("div");
  body.className = "panel-body";
  panel.appendChild(body);

  // ------------------------------------------------------------
  // UI: result row
  // ------------------------------------------------------------
  const resultRow = document.createElement("div");
  resultRow.className = "row-result";

  const resultEl = document.createElement("div");
  resultEl.id = "measure-result";
  resultEl.textContent = "Klicka för att börja mäta";

  resultRow.appendChild(resultEl);
  body.appendChild(resultRow);

  // ------------------------------------------------------------
  // UI: button row
  // ------------------------------------------------------------
  const btnRow = document.createElement("div");
  btnRow.className = "row-buttons";

  const startBtn = document.createElement("button");
  startBtn.className = "tool-button";
  startBtn.title = "På/av distansmätning";
  startBtn.style.setProperty("--icon", "var(--black-icon-edit)");

  const clearBtn = document.createElement("button");
  clearBtn.className = "tool-button";
  clearBtn.title = "Rensa distansmätningar";
  clearBtn.style.setProperty("--icon", "var(--black-icon-delete)");

  btnRow.appendChild(startBtn);
  btnRow.appendChild(clearBtn);
  body.appendChild(btnRow);

  // ------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------
  let isDrawing = false;
  let handler = null;

  // Active sketch points:
  // - fixed clicked points
  // - plus one trailing floating preview point while drawing
  let pts = [];

  // Temporary entities used while drawing the current measurement
  let floatPt = null;
  let lineEnt = null;
  let dynamicLabel = null;

  // Fixed markers for the currently active measurement
  let markerEntities = [];

  // Saved / finalized measurements
  const measuredLines = [];
  const measuredLabels = [];
  const measuredMarkers = [];

  // Temporary highlight state for finalized markers
  let highlightedMarker = null;
  let highlightSegmentPositions = [];
  let highlightSegmentEnt = null;

  const DOUBLE_CLICK_MS = 300;
  const DOUBLE_CLICK_PX = 8;

  let lastCommittedClickTime = 0;
  let lastCommittedClickPosition = null;

  // ------------------------------------------------------------
  // Helper: compute total polyline length
  // ------------------------------------------------------------
  function computeLength(positions) {
    if (!positions || positions.length < 2) return 0;

    let total = 0;

    for (let i = 1; i < positions.length; i++) {
      total += Cartesian3.distance(positions[i - 1], positions[i]);
    }

    return total;
  }

  // ------------------------------------------------------------
  // Helper: build dynamic positions for the preview line
  // ------------------------------------------------------------
  function makeDynamicLine() {
    return new CallbackProperty(() => pts.slice(), false);
  }

  // ------------------------------------------------------------
  // Helper: tag an entity as belonging to this measurement tool
  // This makes it easy to identify and manage measurement entities
  // ------------------------------------------------------------
  function tagMeasureEntity(entity, extra = {}) {
    entity.measureMeta = {
      isMeasureEntity: true,
      tool: "distance",
      ...extra
    };

    return entity;
  }


  // ------------------------------------------------------------
  // Reset click debounce state (used to prevent double click from adding an extra point)
  // ------------------------------------------------------------

  function resetClickDebounce() {
      lastCommittedClickTime = 0;
      lastCommittedClickPosition = null;
    }

  function isSecondClickOfDoubleClick(windowPosition) {
    if (!lastCommittedClickPosition) return false;

    const dt = Date.now() - lastCommittedClickTime;
    const dx = windowPosition.x - lastCommittedClickPosition.x;
    const dy = windowPosition.y - lastCommittedClickPosition.y;
    const pixelDistance = Math.hypot(dx, dy);

    return dt <= DOUBLE_CLICK_MS && pixelDistance <= DOUBLE_CLICK_PX;
  }

  function rememberCommittedClick(windowPosition) {
    lastCommittedClickTime = Date.now();
    lastCommittedClickPosition = new Cartesian2(windowPosition.x, windowPosition.y);
  }

  // ------------------------------------------------------------
  // Helper: create a point marker
  // Used both for fixed clicked points and the floating preview point
  // ------------------------------------------------------------
  function createMarker(position, extraMeta = {}) {
    return tagMeasureEntity(
      viewer.entities.add({
        position,
        point: {
          pixelSize: 6,
          color: Color.YELLOW
        }
      }),
      {
        kind: "punkt",
        ...extraMeta
      }
    );
  }

  // ------------------------------------------------------------
  // Helper: create one reusable highlight segment entity
  // Instead of creating a new highlight line on every click,
  // this one entity is reused for better performance
  // ------------------------------------------------------------
  function ensureHighlightSegment() {
    if (highlightSegmentEnt) return;

    highlightSegmentEnt = viewer.entities.add({
      show: false,
      polyline: {
        positions: new CallbackProperty(() => highlightSegmentPositions, false),
        width: 6,
        material: Color.ORANGE,
        clampToGround: true
      }
    });
  }

  // ------------------------------------------------------------
  // Helper: clear temporary highlight from the selected final point
  // Restores the point style and hides the highlighted segment
  // ------------------------------------------------------------
  function clearSelectionHighlight() {
    if (highlightedMarker?.point) {
      highlightedMarker.point.color = Color.YELLOW;
      highlightedMarker.point.pixelSize = 6;
    }

    highlightedMarker = null;
    highlightSegmentPositions = [];

    if (highlightSegmentEnt) {
      highlightSegmentEnt.show = false;
    }
  }

  // ------------------------------------------------------------
  // Helper: highlight one finalized point marker and its segment
  //
  // Behavior:
  // - First point: only highlight the point itself
  // - Other points: highlight the point and the segment ending there
  // ------------------------------------------------------------
  function highlightMarkerAndSegment(marker) {
    clearSelectionHighlight();

    if (!marker?.measureMeta) return;
    if (marker.measureMeta.tool !== "distance") return;
    if (marker.measureMeta.kind !== "final-point") return;

    highlightedMarker = marker;

    // Highlight the clicked marker itself
    marker.point.color = Color.ORANGE;
    marker.point.pixelSize = 10;

    // First point has no segment attached to it
    const { segmentStart, segmentEnd } = marker.measureMeta;
    if (!defined(segmentStart) || !defined(segmentEnd)) return;

    ensureHighlightSegment();
    highlightSegmentPositions = [segmentStart, segmentEnd];
    highlightSegmentEnt.show = true;
  }

  // ------------------------------------------------------------
  // Helper: handle entity selection changes
  //
  // While drawing:
  // - suppress selection for all measurement entities
  //
  // When not drawing:
  // - clicking a finalized point highlights that point and segment
  // - clicking anything else clears the temporary highlight
  // ------------------------------------------------------------
  function onSelectedEntityChanged(entity) {
    // Suppress selection/info popup on measurement entities while drawing
    if (isDrawing) {
      if (entity?.measureMeta?.isMeasureEntity) {
        viewer.selectedEntity = undefined;
      }
      return;
    }

    // When not drawing, allow final distance points to trigger highlight
    if (
      entity?.measureMeta?.tool === "distance" &&
      entity?.measureMeta?.kind === "final-point"
    ) {
      highlightMarkerAndSegment(entity);
      return;
    }

    // Any other selection clears the current highlight
    clearSelectionHighlight();
  }

  // ------------------------------------------------------------
  // Helper: add metadata to finalized point markers
  //
  // Marker meaning:
  // - Point 1 = start point
  // - Point 2 = end of segment 1
  // - Point 3 = end of segment 2
  // - etc.
  //
  // This metadata is later used to:
  // - show per-point segment info
  // - highlight the correct segment when a point is clicked
  // ------------------------------------------------------------
  function applyMarkerMetadata(finalPts) {
    markerEntities.forEach((marker, index) => {
      // First point: start point only, no segment
      if (index === 0) {
        marker.name = "Startpunkt";
        marker.description = `
          <table class="cesium-infoBox-defaultTable">
            <tbody>
              <tr><th>Punkt nr</th><td>1</td></tr>
            </tbody>
          </table>
        `;

        marker.measureMeta = {
          ...marker.measureMeta,
          kind: "final-point",
          pointIndex: 1,
          segmentIndex: null,
          segmentLengthMeters: null,
          segmentStart: null,
          segmentEnd: null
        };

        return;
      }

      const segmentLength = Cartesian3.distance(
        finalPts[index - 1],
        finalPts[index]
      );

      marker.name = `Punkt ${index + 1}`;
      marker.description = `
        <table class="cesium-infoBox-defaultTable">
          <tbody>
            <tr><th>Typ</th><td>Mätpunkt</td></tr>
            <tr><th>Punkt nr</th><td>${index + 1}</td></tr>
            <tr><th>Segment nr</th><td>${index}</td></tr>
            <tr><th>Längd</th><td>${segmentLength.toFixed(2)} m</td></tr>
          </tbody>
        </table>
      `;

      marker.measureMeta = {
        ...marker.measureMeta,
        kind: "final-point",
        pointIndex: index + 1,
        segmentIndex: index,
        segmentLengthMeters: segmentLength,
        segmentStart: Cartesian3.clone(finalPts[index - 1]),
        segmentEnd: Cartesian3.clone(finalPts[index])
      };
    });
  }

  // ------------------------------------------------------------
  // Finalize the current line and convert temporary entities
  // into permanent measurement entities
  // ------------------------------------------------------------
  function finalizeLine() {
    // The last point in "pts" is always the floating preview point
    const finalPts = pts.slice(0, -1);

    // If double click caused the last fixed point to be added twice,
    // remove the duplicate trailing point.
    if (finalPts.length >= 2) {
      const a = finalPts[finalPts.length - 1];
      const b = finalPts[finalPts.length - 2];

      if (Cartesian3.distance(a, b) < 0.01) {
        finalPts = finalPts.slice(0, -1);
      }
    }

    // A valid measurement needs at least 2 fixed points
    if (finalPts.length < 2) return;

    // Remove temporary drawing helpers
    if (floatPt) {
      viewer.entities.remove(floatPt);
      floatPt = null;
    }

    if (lineEnt) {
      viewer.entities.remove(lineEnt);
      lineEnt = null;
    }

    if (dynamicLabel) {
      viewer.entities.remove(dynamicLabel);
      dynamicLabel = null;
    }

    // Turn the current fixed markers into finalized measurement markers
    applyMarkerMetadata(finalPts);

    const totalLength = computeLength(finalPts);

    // Create the permanent red measurement line
    const line = tagMeasureEntity(
      viewer.entities.add({
        polyline: {
          positions: finalPts,
          width: 3,
          material: Color.RED,
          clampToGround: true
        },
        name: "Distansmätning",
        description: `
          <table class="cesium-infoBox-defaultTable">
            <tbody>
              <tr><th>Total längd</th><td>${totalLength.toFixed(2)} m</td></tr>
              <tr><th>Totalt antal punkter</th><td>${finalPts.length}</td></tr>
            </tbody>
          </table>
        `
      }),
      {
        kind: "final-line",
        totalLengthMeters: totalLength,
        vertexCount: finalPts.length
      }
    );

    measuredLines.push(line);

    // Create a permanent label at the last point
    const last = finalPts[finalPts.length - 1];

    const label = tagMeasureEntity(
      viewer.entities.add({
        position: last,
        label: {
          text: `${totalLength.toFixed(2)} m`,
          font: "bold 16px sans-serif",
          fillColor: Color.BLACK,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.WHITE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -10),
          heightReference: HeightReference.CLAMP_TO_GROUND
        },
        name: "Distansetikett",
        description: `
          <table class="cesium-infoBox-defaultTable">
            <tbody>
              <tr><th>Total längd</th><td>${totalLength.toFixed(2)} m</td></tr>
            </tbody>
          </table>
        `
      }),
      {
        kind: "final-label",
        totalLengthMeters: totalLength
      }
    );

    measuredLabels.push(label);

    // Save the finalized point markers for later clear/remove handling
    measuredMarkers.push([...markerEntities]);

    // Reset active drawing state so a new measurement can begin
    pts = [];
    markerEntities = [];

    resetClickDebounce();

    resultEl.textContent = `Senaste mätning: ${totalLength.toFixed(2)} m`;
  }

  // ------------------------------------------------------------
  // Start drawing mode
  // ------------------------------------------------------------
  function startDrawing() {
    isDrawing = true;
    resetClickDebounce();
    startBtn.style.setProperty("--icon", "var(--black-icon-edit-off)");
    resultEl.textContent = "Klicka för att lägga till punkter, dubbelklicka för att färdigställa.";

    // Clear any existing highlight when starting a new sketch
    clearSelectionHighlight();

    if (viewer.selectedEntity?.measureMeta?.tool === "distance") {
      viewer.selectedEntity = undefined;
    }

    handler = new ScreenSpaceEventHandler(viewer.canvas);

    pts = [];
    floatPt = null;
    lineEnt = null;
    dynamicLabel = null;
    markerEntities = [];

    // LEFT CLICK: add a fixed point
    handler.setInputAction(evt => {

       if (isSecondClickOfDoubleClick(evt.position)) {
        return;
      }

      const pos = viewer.scene.pickPosition(evt.position);
      if (!defined(pos)) return;

      // First click:
      // - create the first fixed point
      // - create a floating preview point
      // - create the preview line
      // - create the dynamic total label
      if (pts.length === 0) {
        pts.push(pos); // fixed point
        pts.push(pos); // floating preview point

        const firstMarker = createMarker(pos, {
          kind: "temp-fixed-point",
          pointIndex: 1
        });
        markerEntities.push(firstMarker);

        floatPt = createMarker(pos, {
          kind: "floating-point"
        });

        lineEnt = tagMeasureEntity(
          viewer.entities.add({
            polyline: {
              positions: makeDynamicLine(),
              width: 5,
              material: Color.YELLOW,
              clampToGround: true
            }
          }),
          {
            kind: "dynamic-line"
          }
        );

        dynamicLabel = tagMeasureEntity(
          viewer.entities.add({
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
          }),
          {
            kind: "dynamic-label"
          }
        );
      } else {
        const fixedPoints = pts.slice(0, -1);
        const lastFixed = fixedPoints[fixedPoints.length - 1];

        // Ignore clicks that are very close to the last fixed point
        if (lastFixed && Cartesian3.distance(lastFixed, pos) < 0.01) {
          return;
        }

        // Replace the current floating preview point with a fixed point
        pts[pts.length - 1] = pos;

        const fixedMarker = createMarker(pos, {
          kind: "temp-fixed-point",
          pointIndex: markerEntities.length + 1
        });
        markerEntities.push(fixedMarker);

        // Add a new floating preview point at the end
        pts.push(pos);
      }

      // Keep the preview line visible
      if (lineEnt) {
        lineEnt.polyline.show = true;
      }
      rememberCommittedClick(evt.position);
    }, ScreenSpaceEventType.LEFT_CLICK);

    // MOUSE MOVE: update the floating preview point and total label
    handler.setInputAction(evt => {
      if (!floatPt || pts.length === 0) return;

      const pos = viewer.scene.pickPosition(evt.endPosition);
      if (!defined(pos)) return;

      floatPt.position.setValue(pos);
      pts[pts.length - 1] = pos;

      if (dynamicLabel) {
        const totalLength = computeLength(pts);
        dynamicLabel.position.setValue(pos);
        dynamicLabel.label.text = `${totalLength.toFixed(2)} m`;
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // DOUBLE CLICK: finalize the current measurement
    handler.setInputAction(() => {
      // Need at least:
      // 2 fixed points + 1 floating preview point
      if (pts.length < 3) return;

      finalizeLine();
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // ESC: undo the latest fixed point
    window.addEventListener("keydown", escHandler);
  }

  // ------------------------------------------------------------
  // Stop drawing mode
  // Removes only temporary entities from the active sketch
  // Finalized measurements remain in the scene
  // ------------------------------------------------------------
  function stopDrawing() {
    isDrawing = false;
    resetClickDebounce();
    startBtn.style.setProperty("--icon", "var(--black-icon-edit)");
    resultEl.textContent = "Klicka för att börja mäta";

    handler?.destroy();
    handler = null;

    window.removeEventListener("keydown", escHandler);

    // If a temporary measurement entity is currently selected, clear it
    if (viewer.selectedEntity?.measureMeta?.isMeasureEntity) {
      viewer.selectedEntity = undefined;
    }

    // Remove temporary dynamic label
    if (dynamicLabel) {
      viewer.entities.remove(dynamicLabel);
      dynamicLabel = null;
    }

    // Remove temporary floating preview marker
    if (floatPt) {
      viewer.entities.remove(floatPt);
      floatPt = null;
    }

    // Remove temporary preview line
    if (lineEnt) {
      viewer.entities.remove(lineEnt);
      lineEnt = null;
    }

    // Remove temporary fixed markers from the unfinished sketch
    markerEntities.forEach(m => viewer.entities.remove(m));
    markerEntities = [];

    pts = [];
  }

  // ------------------------------------------------------------
  // ESC handler: undo the latest fixed point while drawing
  //
  // Important structure:
  // pts = [fixed1, fixed2, ..., fixedN, preview]
  //
  // Therefore:
  // - the last element is always the floating preview point
  // - the last fixed point is at pts.length - 2
  // ------------------------------------------------------------
  function escHandler(evt) {
    if (evt.key !== "Escape" || !isDrawing) return;
    if (!floatPt || pts.length === 0) return;

    const fixedCount = pts.length - 1;

    // Nothing to undo
    if (fixedCount <= 0) return;

    // If only one fixed point remains, remove the whole active sketch
    if (fixedCount === 1) {
      const lastMarker = markerEntities.pop();
      if (lastMarker) viewer.entities.remove(lastMarker);

      if (floatPt) {
        viewer.entities.remove(floatPt);
        floatPt = null;
      }

      if (dynamicLabel) {
        viewer.entities.remove(dynamicLabel);
        dynamicLabel = null;
      }

      if (lineEnt) {
        viewer.entities.remove(lineEnt);
        lineEnt = null;
      }

      pts = [];
      resultEl.textContent = "Klicka för att lägga till punkter, dubbelklicka för att färdigställa.";
      return;
    }

    // Remove the last fixed point, but keep the floating preview point
    // Example:
    // [fixed1, fixed2, fixed3, preview] -> remove fixed3
    pts.splice(pts.length - 2, 1);

    const lastMarker = markerEntities.pop();
    if (lastMarker) viewer.entities.remove(lastMarker);

    // Update preview line visibility
    if (lineEnt) {
      lineEnt.polyline.show = pts.length >= 2;
    }

    // Update dynamic total label at the preview position
    if (dynamicLabel) {
      const previewPos = pts[pts.length - 1];
      const totalLength = computeLength(pts);

      dynamicLabel.position.setValue(previewPos);
      dynamicLabel.label.text = `${totalLength.toFixed(2)} m`;
    }
  }

  // ------------------------------------------------------------
  // Clear all finalized measurements and any temporary highlight
  // ------------------------------------------------------------
  function clearAll() {
    // Stop active drawing first
    stopDrawing();

    // Clear temporary selection highlight
    clearSelectionHighlight();

    if (viewer.selectedEntity?.measureMeta?.tool === "distance") {
      viewer.selectedEntity = undefined;
    }

    // Remove finalized lines
    measuredLines.forEach(e => viewer.entities.remove(e));

    // Remove finalized total labels
    measuredLabels.forEach(e => viewer.entities.remove(e));

    // Remove finalized point markers
    measuredMarkers.forEach(markerList => {
      markerList.forEach(m => viewer.entities.remove(m));
    });

    measuredLines.length = 0;
    measuredLabels.length = 0;
    measuredMarkers.length = 0;

    // Remove reusable highlight segment entity
    if (highlightSegmentEnt) {
      viewer.entities.remove(highlightSegmentEnt);
      highlightSegmentEnt = null;
    }

    highlightSegmentPositions = [];

    resultEl.textContent = "Click to start measuring";
  }

  // ------------------------------------------------------------
  // UI events
  // ------------------------------------------------------------
  startBtn.addEventListener("click", () => {
    isDrawing ? stopDrawing() : startDrawing();
  });

  clearBtn.addEventListener("click", clearAll);

  // ------------------------------------------------------------
  // Keep listening for selection changes
  //
  // This is intentionally added once during initialization so that:
  // - selection is suppressed while drawing
  // - finalized points can still be highlighted when not drawing
  // ------------------------------------------------------------
  viewer.selectedEntityChanged.addEventListener(onSelectedEntityChanged);

  // ------------------------------------------------------------
  // If the panel is hidden while drawing, stop the current sketch
  // ------------------------------------------------------------
  new MutationObserver(() => {
    if (getComputedStyle(panel).display === "none" && isDrawing) {
      stopDrawing();
    }
  }).observe(panel, {
    attributes: true,
    attributeFilter: ["style"]
  });

  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------
  return {
    stop: stopDrawing
  };
}