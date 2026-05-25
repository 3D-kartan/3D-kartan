// src/tools/measure/measure-area.js

import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  CallbackProperty,
  defined,
  Cartesian3,
  Cartesian2,
  Color,
  PolygonHierarchy,
  HeightReference,
  Matrix4,
  Transforms,
  Ellipsoid,
  LabelStyle,
  VerticalOrigin
} from "cesium";

/**
 * Area measurement tool for Cesium.
 *
 * Features:
 * - Click to add polygon vertices
 * - Move mouse to preview the polygon
 * - Double click to finalize the polygon
 * - ESC removes the latest fixed point in the active sketch
 * - Clear removes all finalized measurements
 *
 * Selection behavior:
 * - Temporary sketch entities never remain selected
 * - Final point markers never remain selected
 * - Clicking a finalized polygon highlights the polygon fill
 * - Clicking a finalized edge highlights the edge and its polygon
 * - Clicking the saved center label highlights the polygon
 *
 * Label behavior:
 * - A dynamic label is shown while drawing
 * - A permanent label is created when the polygon is finalized
 *
 * Geometry behavior:
 * - Area and perimeter are computed in a local ENU 2D plane
 * - This makes the values stable and practical for local measurements
 *
 * @param {HTMLElement} panel
 * @param {import("cesium").Viewer} viewer
 * @returns {{ stop: Function, destroy: Function }}
 */
export default function initMeasureArea(panel, viewer) {
  // ---------------------------------------------------------------------------
  // Guard against duplicate initialization on the same panel/viewer combo
  // ---------------------------------------------------------------------------
  if (viewer.__measureAreaApi) {
    return viewer.__measureAreaApi;
  }

  // ---------------------------------------------------------------------------
  // Visual style constants
  // ---------------------------------------------------------------------------
  const PREVIEW_FILL = Color.YELLOW.withAlpha(0.25);
  const PREVIEW_EDGE = Color.YELLOW;

  const FINAL_FILL = Color.RED.withAlpha(0.25);
  const FINAL_EDGE = Color.RED;

  const HIGHLIGHT_FILL = Color.ORANGE.withAlpha(0.45);
  const HIGHLIGHT_EDGE = Color.ORANGE;

  const FINAL_POINT_COLOR = Color.YELLOW;
  const FINAL_POINT_SIZE = 6;

  const FINAL_EDGE_WIDTH = 3;
  const HIGHLIGHT_EDGE_WIDTH = 6;

  // ---------------------------------------------------------------------------
  // DOM setup
  // ---------------------------------------------------------------------------
  const body = document.createElement("div");
  body.className = "panel-body";
  panel.appendChild(body);

  const resultRow = document.createElement("div");
  resultRow.className = "row-result";

  const resultEl = document.createElement("div");
  resultEl.id = "measure-area-result";
  resultEl.textContent = "Klicka för att börja mäta";

  resultRow.appendChild(resultEl);
  body.appendChild(resultRow);

  const btnRow = document.createElement("div");
  btnRow.className = "row-buttons";

  const startBtn = document.createElement("button");
  startBtn.className = "tool-button";
  startBtn.title = "På/av areamätning";
  startBtn.style.setProperty("--icon", "var(--black-icon-edit)");

  const clearBtn = document.createElement("button");
  clearBtn.className = "tool-button";
  clearBtn.title = "Rensa areamätningar";
  clearBtn.style.setProperty("--icon", "var(--black-icon-delete)");

  btnRow.appendChild(startBtn);
  btnRow.appendChild(clearBtn);
  body.appendChild(btnRow);

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------
  let isDrawing = false;

  // Active drawing handler
  let drawHandler = null;

  // Explicit click handler for finalized measurement entities
  let finalizedClickHandler = null;

  // Panel visibility observer
  let panelObserver = null;

  // Keyboard handler reference
  let escKeyListener = null;

  // Active sketch points:
  // [fixed1, fixed2, ..., fixedN, preview]
  let pts = [];

  // Temporary entities for active sketch
  let floatPt = null;
  let tempPolygon = null;
  let tempOutline = null;
  let tempInfoLabel = null;
  let markerEntities = [];

  // Finalized measurements
  const measurements = [];
  const measurementById = new Map();
  let nextMeasurementId = 1;

  // Current highlight state
  let highlightedPolygon = null;
  let highlightedEdge = null;

  const DOUBLE_CLICK_MS = 300;
  const DOUBLE_CLICK_PX = 8;

  let lastCommittedClickTime = 0;
  let lastCommittedClickPosition = null;

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------
  function formatMeters(value) {
    return `${value.toFixed(2)} m`;
  }

  function formatSquareMeters(value) {
    return `${value.toFixed(2)} m²`;
  }

  function buildDynamicLabelText(area2D, perimeter) {
    return `2D area: ${formatSquareMeters(area2D)}\nOmkrets: ${formatMeters(perimeter)}`;
  }

  function buildPolygonDescription(area2D, perimeter) {
    return `
      <table class="cesium-infoBox-defaultTable">
        <tbody>
          <tr><th>2D area</th><td>${formatSquareMeters(area2D)}</td></tr>
          <tr><th>Omkrets</th><td>${formatMeters(perimeter)}</td></tr>
        </tbody>
      </table>
    `;
  }

  function buildEdgeDescription(edgeIndex, edgeLength, area2D, perimeter) {
    return `
      <table class="cesium-infoBox-defaultTable">
        <tbody>
          <tr><th>Kantlängd</th><td>${formatMeters(edgeLength)}</td></tr>
          <tr><th>2D area</th><td>${formatSquareMeters(area2D)}</td></tr>
          <tr><th>Omkrets</th><td>${formatMeters(perimeter)}</td></tr>
        </tbody>
      </table>
    `;
  }

  // ---------------------------------------------------------------------------
  // Entity metadata helper
  // ---------------------------------------------------------------------------
  function tagMeasureEntity(entity, extra = {}) {
    entity.measureMeta = {
      isMeasureEntity: true,
      tool: "area",
      ...extra
    };

    return entity;
  }

  // ---------------------------------------------------------------------------
  // Picking helper
  //
  // pickPosition works well for terrain / 3D tiles when supported.
  // Globe pick is used as a fallback.
  // ---------------------------------------------------------------------------
  function pickWorldPosition(windowPosition) {
    const scene = viewer.scene;

    if (scene.pickPositionSupported) {
      const picked = scene.pickPosition(windowPosition);
      if (defined(picked)) return picked;
    }

    const ray = viewer.camera.getPickRay(windowPosition);
    if (!ray) return undefined;

    return scene.globe.pick(ray, scene);
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------
  function computeSurfaceOrigin(positions) {
    if (!positions || positions.length === 0) {
      return Cartesian3.fromDegrees(0, 0, 0);
    }

    const avg = new Cartesian3(0, 0, 0);

    positions.forEach((p) => {
      avg.x += p.x;
      avg.y += p.y;
      avg.z += p.z;
    });

    avg.x /= positions.length;
    avg.y /= positions.length;
    avg.z /= positions.length;

    return Ellipsoid.WGS84.scaleToGeodeticSurface(avg, new Cartesian3()) || positions[0];
  }

  function projectToLocal2D(positions) {
    const origin = computeSurfaceOrigin(positions);
    const transform = Transforms.eastNorthUpToFixedFrame(origin);
    const inverse = Matrix4.inverseTransformation(transform, new Matrix4());

    const localPoints = positions.map((worldPos) => {
      const local = Matrix4.multiplyByPoint(inverse, worldPos, new Cartesian3());
      return { x: local.x, y: local.y };
    });

    return {
      origin,
      transform,
      inverse,
      localPoints
    };
  }

  function computeLocalCentroid(localPoints, signedDoubleArea) {
    if (!localPoints || localPoints.length === 0) {
      return { x: 0, y: 0 };
    }

    // Fallback for degenerate polygons
    if (Math.abs(signedDoubleArea) < 1e-9) {
      let sx = 0;
      let sy = 0;

      localPoints.forEach((p) => {
        sx += p.x;
        sy += p.y;
      });

      return {
        x: sx / localPoints.length,
        y: sy / localPoints.length
      };
    }

    let cx = 0;
    let cy = 0;

    for (let i = 0; i < localPoints.length; i++) {
      const a = localPoints[i];
      const b = localPoints[(i + 1) % localPoints.length];
      const cross = a.x * b.y - b.x * a.y;

      cx += (a.x + b.x) * cross;
      cy += (a.y + b.y) * cross;
    }

    return {
      x: cx / (3 * signedDoubleArea),
      y: cy / (3 * signedDoubleArea)
    };
  }

  /**
   * Compute 2D area, perimeter and centroid in local ENU coordinates.
   *
   * closeRing = true:
   *   - polygon perimeter
   *   - polygon area
   *
   * closeRing = false:
   *   - open polyline length only
   *   - area = 0
   */
  function compute2DStats(positions, closeRing = true) {
    if (!positions || positions.length === 0) {
      return {
        area2D: 0,
        perimeter: 0,
        centroidWorld: null
      };
    }

    const { transform, localPoints } = projectToLocal2D(positions);

    let perimeter = 0;

    if (localPoints.length >= 2) {
      const lastIndex = closeRing ? localPoints.length : localPoints.length - 1;

      for (let i = 0; i < lastIndex; i++) {
        const a = localPoints[i];
        const b = localPoints[(i + 1) % localPoints.length];
        perimeter += Math.hypot(b.x - a.x, b.y - a.y);
      }
    }

    let signedDoubleArea = 0;
    let area2D = 0;

    if (closeRing && localPoints.length >= 3) {
      for (let i = 0; i < localPoints.length; i++) {
        const a = localPoints[i];
        const b = localPoints[(i + 1) % localPoints.length];
        signedDoubleArea += a.x * b.y - b.x * a.y;
      }

      area2D = Math.abs(signedDoubleArea) * 0.5;
    }

    const centroidLocal = computeLocalCentroid(localPoints, signedDoubleArea);

    const centroidWorld = Matrix4.multiplyByPoint(
      transform,
      new Cartesian3(centroidLocal.x, centroidLocal.y, 0),
      new Cartesian3()
    );

    return {
      area2D,
      perimeter,
      centroidWorld
    };
  }

  // ---------------------------------------------------------------------------
  // Entity factory helpers
  // ---------------------------------------------------------------------------
  function createMarker(position, extraMeta = {}) {
    return tagMeasureEntity(
      viewer.entities.add({
        position,
        point: {
          pixelSize: FINAL_POINT_SIZE,
          color: FINAL_POINT_COLOR,
          heightReference: HeightReference.CLAMP_TO_GROUND
        }
      }),
      {
        kind: "point",
        ...extraMeta
      }
    );
  }

  function createCenterLabel(position, text, extraMeta = {}) {
    return tagMeasureEntity(
      viewer.entities.add({
        position,
        label: {
          text,
          font: "bold 14px sans-serif",
          fillColor: Color.BLACK,
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineColor: Color.WHITE,
          outlineWidth: 3,
          showBackground: true,
          backgroundColor: Color.WHITE.withAlpha(0.85),
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(0, 0),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      }),
      {
        kind: "final-label",
        ...extraMeta
      }
    );
  }

  function makeDynamicPolygonHierarchy() {
    return new CallbackProperty(() => {
      if (pts.length < 3) {
        return new PolygonHierarchy([]);
      }

      return new PolygonHierarchy(pts.slice());
    }, false);
  }

  function buildPreviewOutlinePositions() {
    if (pts.length === 0) return [];
    if (pts.length < 3) return pts.slice();

    return [...pts, pts[0]];
  }

  function updateDynamicCenterLabel() {
    if (!tempInfoLabel) return;

    // The sketch needs at least 3 preview points to form a polygon
    if (pts.length < 3) {
      tempInfoLabel.show = false;
      return;
    }

    const { area2D, perimeter, centroidWorld } = compute2DStats(pts, true);

    if (!centroidWorld) {
      tempInfoLabel.show = false;
      return;
    }

    tempInfoLabel.position.setValue(centroidWorld);
    tempInfoLabel.label.text = buildDynamicLabelText(area2D, perimeter);
    tempInfoLabel.show = true;
  }

  // ---------------------------------------------------------------------------
  // Highlight helpers
  // ---------------------------------------------------------------------------
  function clearHighlight() {
    if (highlightedPolygon?.polygon) {
      highlightedPolygon.polygon.material = FINAL_FILL;
    }

    if (highlightedEdge?.polyline) {
      highlightedEdge.polyline.material = FINAL_EDGE;
      highlightedEdge.polyline.width = FINAL_EDGE_WIDTH;
    }

    highlightedPolygon = null;
    highlightedEdge = null;
  }

  function highlightPolygonSelection(measurement) {
    clearHighlight();

    if (!measurement?.polygon?.polygon) return;

    measurement.polygon.polygon.material = HIGHLIGHT_FILL;
    highlightedPolygon = measurement.polygon;
  }

  function highlightEdgeSelection(measurement, edgeEntity) {
    clearHighlight();

    if (!measurement?.polygon?.polygon || !edgeEntity?.polyline) return;

    measurement.polygon.polygon.material = HIGHLIGHT_FILL;
    edgeEntity.polyline.material = HIGHLIGHT_EDGE;
    edgeEntity.polyline.width = HIGHLIGHT_EDGE_WIDTH;

    highlightedPolygon = measurement.polygon;
    highlightedEdge = edgeEntity;
  }

  // ---------------------------------------------------------------------------
  // Cleanup helpers
  // ---------------------------------------------------------------------------
  function removeTemporarySketchEntities() {
    if (floatPt) {
      viewer.entities.remove(floatPt);
      floatPt = null;
    }

    if (tempPolygon) {
      viewer.entities.remove(tempPolygon);
      tempPolygon = null;
    }

    if (tempOutline) {
      viewer.entities.remove(tempOutline);
      tempOutline = null;
    }

    if (tempInfoLabel) {
      viewer.entities.remove(tempInfoLabel);
      tempInfoLabel = null;
    }

    markerEntities.forEach((m) => viewer.entities.remove(m));
    markerEntities = [];
  }

  function removeMeasurement(measurement) {
    if (!measurement) return;

    if (measurement.polygon) {
      viewer.entities.remove(measurement.polygon);
    }

    if (measurement.centerLabel) {
      viewer.entities.remove(measurement.centerLabel);
    }

    measurement.edges.forEach((edge) => viewer.entities.remove(edge));
    measurement.markers.forEach((marker) => viewer.entities.remove(marker));

    measurementById.delete(measurement.id);
  }

  // ---------------------------------------------------------------------------
  // Reset click debounce state (used to prevent double click from adding an extra point)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Finalize one polygon measurement
  // ---------------------------------------------------------------------------
  function finalizePolygon() {
    // The last point in pts is the floating preview point
    let finalPts = pts.slice(0, -1);

    // If double click caused the last fixed point to be added twice,
    // remove the duplicate trailing point.
    if (finalPts.length >= 2) {
      const a = finalPts[finalPts.length - 1];
      const b = finalPts[finalPts.length - 2];

      if (Cartesian3.distance(a, b) < 0.01) {
        finalPts = finalPts.slice(0, -1);
      }
    }

    if (finalPts.length < 3) return;

    const { area2D, perimeter, centroidWorld } = compute2DStats(finalPts, true);
    const measurementId = nextMeasurementId++;

    // Remove temporary preview-specific entities
    if (floatPt) {
      viewer.entities.remove(floatPt);
      floatPt = null;
    }

    if (tempPolygon) {
      viewer.entities.remove(tempPolygon);
      tempPolygon = null;
    }

    if (tempOutline) {
      viewer.entities.remove(tempOutline);
      tempOutline = null;
    }

    if (tempInfoLabel) {
      viewer.entities.remove(tempInfoLabel);
      tempInfoLabel = null;
    }

    // Convert current temp markers to finalized markers
    markerEntities.forEach((marker, index) => {
      marker.measureMeta = {
        ...marker.measureMeta,
        kind: "final-point",
        measurementId,
        pointIndex: index + 1
      };
    });

    const polygonEntity = tagMeasureEntity(
      viewer.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(finalPts),
          material: FINAL_FILL
        },
        name: "Area mätning",
        description: buildPolygonDescription(area2D, perimeter)
      }),
      {
        kind: "final-polygon",
        measurementId,
        area2D,
        perimeter
      }
    );

    const centerLabelEntity = centroidWorld
      ? createCenterLabel(
          centroidWorld,
          buildDynamicLabelText(area2D, perimeter),
          { measurementId }
        )
      : null;

    const edgeEntities = [];

    for (let i = 0; i < finalPts.length; i++) {
      const start = finalPts[i];
      const end = finalPts[(i + 1) % finalPts.length];
      const edgeLength = compute2DStats([start, end], false).perimeter;

      const edgeEntity = tagMeasureEntity(
        viewer.entities.add({
          polyline: {
            positions: [start, end],
            width: FINAL_EDGE_WIDTH,
            material: FINAL_EDGE,
            clampToGround: true
          },
          name: `Polygonkant ${i + 1}`,
          description: buildEdgeDescription(i + 1, edgeLength, area2D, perimeter)
        }),
        {
          kind: "final-edge",
          measurementId,
          edgeIndex: i + 1,
          edgeLengthMeters: edgeLength
        }
      );

      edgeEntities.push(edgeEntity);
    }

    const measurement = {
      id: measurementId,
      polygon: polygonEntity,
      edges: edgeEntities,
      centerLabel: centerLabelEntity,
      markers: [...markerEntities],
      positions: finalPts.slice(),
      area2D,
      perimeter
    };

    measurements.push(measurement);
    measurementById.set(measurementId, measurement);

    // Reset sketch state
    pts = [];
    markerEntities = [];
    
    resetClickDebounce();
    
    resultEl.textContent =
      `Senaste mätning: 2D area: ${formatSquareMeters(area2D)} | ` +
      `Omkrets: ${formatMeters(perimeter)}`;
  }

  // ---------------------------------------------------------------------------
  // Drawing lifecycle
  // ---------------------------------------------------------------------------
  function startDrawing() {
    if (isDrawing) return;

    isDrawing = true;
    startBtn.style.setProperty("--icon", "var(--black-icon-edit-off)");
    resultEl.textContent = "Klicka för att lägga till punkter, dubbelklicka för att avsluta polygonen";

    clearHighlight();

    if (viewer.selectedEntity?.measureMeta?.tool === "area") {
      viewer.selectedEntity = undefined;
    }

    pts = [];
    floatPt = null;
    tempPolygon = null;
    tempOutline = null;
    tempInfoLabel = null;
    markerEntities = [];

    drawHandler = new ScreenSpaceEventHandler(viewer.canvas);

    // Add fixed points
    drawHandler.setInputAction((evt) => {

      if (isSecondClickOfDoubleClick(evt.position)) {
        return;
      }

      const pos = pickWorldPosition(evt.position);
      if (!defined(pos)) return;

      // First click creates the initial fixed point plus the preview point
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

        tempPolygon = tagMeasureEntity(
          viewer.entities.add({
            polygon: {
              hierarchy: makeDynamicPolygonHierarchy(),
              material: PREVIEW_FILL
            }
          }),
          {
            kind: "dynamic-polygon"
          }
        );

        tempOutline = tagMeasureEntity(
          viewer.entities.add({
            polyline: {
              positions: new CallbackProperty(() => buildPreviewOutlinePositions(), false),
              width: FINAL_EDGE_WIDTH,
              material: PREVIEW_EDGE,
              clampToGround: true
            }
          }),
          {
            kind: "dynamic-outline"
          }
        );

        tempInfoLabel = tagMeasureEntity(
          viewer.entities.add({
            position: pos,
            show: false,
            label: {
              text: "",
              font: "bold 14px sans-serif",
              fillColor: Color.BLACK,
              style: LabelStyle.FILL_AND_OUTLINE,
              outlineColor: Color.WHITE,
              outlineWidth: 3,
              showBackground: true,
              backgroundColor: Color.WHITE.withAlpha(0.85),
              verticalOrigin: VerticalOrigin.CENTER,
              pixelOffset: new Cartesian2(0, 0),
              heightReference: HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
          }),
          {
            kind: "dynamic-label"
          }
        );
      } else {
        const fixedPoints = pts.slice(0, -1);
        const lastFixed = fixedPoints[fixedPoints.length - 1];

        // Ignore duplicate click on the same point
        if (lastFixed && Cartesian3.distance(lastFixed, pos) < 0.01) {
          return;
        }
        // Replace the last preview point with a fixed point
        pts[pts.length - 1] = pos;

        const fixedMarker = createMarker(pos, {
          kind: "temp-fixed-point",
          pointIndex: markerEntities.length + 1
        });
        markerEntities.push(fixedMarker);

        // Add a new preview point at the end
        pts.push(pos);
      }
      rememberCommittedClick(evt.position);
      updateDynamicCenterLabel();
    }, ScreenSpaceEventType.LEFT_CLICK);

    // Update floating preview point
    drawHandler.setInputAction((evt) => {
      if (!floatPt || pts.length === 0) return;

      const pos = pickWorldPosition(evt.endPosition);
      if (!defined(pos)) return;

      floatPt.position.setValue(pos);
      pts[pts.length - 1] = pos;

      updateDynamicCenterLabel();
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // Finalize polygon
    drawHandler.setInputAction(() => {
      // Need at least 3 fixed points + 1 preview point
      if (pts.length < 4) return;
      finalizePolygon();
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    escKeyListener = (evt) => {
      if (evt.key !== "Escape" || !isDrawing) return;
      if (!floatPt || pts.length === 0) return;

      const fixedCount = pts.length - 1;
      if (fixedCount <= 0) return;

      // If only one fixed point remains, clear the whole sketch
      if (fixedCount === 1) {
        removeTemporarySketchEntities();
        pts = [];
        resultEl.textContent = "Click to add points, double click to finish polygon";
        return;
      }

      // Remove the latest fixed point, keep the preview point
      pts.splice(pts.length - 2, 1);

      const lastMarker = markerEntities.pop();
      if (lastMarker) {
        viewer.entities.remove(lastMarker);
      }

      updateDynamicCenterLabel();
    };

    window.addEventListener("keydown", escKeyListener);
  }

  function stopDrawing() {
    if (!isDrawing) return;

    isDrawing = false;
     resetClickDebounce();
    startBtn.style.setProperty("--icon", "var(--black-icon-edit)");
    resultEl.textContent = "Klicka för börja mäta";

    if (drawHandler) {
      drawHandler.destroy();
      drawHandler = null;
    }

    if (escKeyListener) {
      window.removeEventListener("keydown", escKeyListener);
      escKeyListener = null;
    }

    if (viewer.selectedEntity?.measureMeta?.tool === "area") {
      viewer.selectedEntity = undefined;
    }

    removeTemporarySketchEntities();
    pts = [];
  }

  function clearAll() {
    stopDrawing();
    clearHighlight();

    if (viewer.selectedEntity?.measureMeta?.tool === "area") {
      viewer.selectedEntity = undefined;
    }

    measurements.forEach(removeMeasurement);
    measurements.length = 0;
    measurementById.clear();

    resultEl.textContent = "Klicka för att börja mäta";
  }

  // ---------------------------------------------------------------------------
  // Selection handling
  //
  // This is still useful as a fallback and for regular Cesium selection.
  // The permanent center label also gets its own explicit click pick handler,
  // because labels do not always end up as selectedEntity in the desired way.
  // ---------------------------------------------------------------------------
  function onSelectedEntityChanged(entity) {
    // Suppress all area-tool selections while actively drawing
    if (isDrawing) {
      if (entity?.measureMeta?.tool === "area") {
        viewer.selectedEntity = undefined;
      }
      return;
    }

    // Any unrelated selection clears current highlight
    if (entity?.measureMeta?.tool !== "area") {
      clearHighlight();
      return;
    }

    // Point markers should never remain selected
    if (
      entity.measureMeta.kind === "temp-fixed-point" ||
      entity.measureMeta.kind === "floating-point" ||
      entity.measureMeta.kind === "final-point"
    ) {
      clearHighlight();
      viewer.selectedEntity = undefined;
      return;
    }

    // Dynamic sketch entities should never remain selected
    if (
      entity.measureMeta.kind === "dynamic-polygon" ||
      entity.measureMeta.kind === "dynamic-outline" ||
      entity.measureMeta.kind === "dynamic-label"
    ) {
      viewer.selectedEntity = undefined;
      return;
    }

    // Permanent label selection is handled explicitly in the custom click handler.
    // If Cesium still selects it here, redirect to polygon highlight and clear selection.
    if (entity.measureMeta.kind === "final-label") {
      const measurement = measurementById.get(entity.measureMeta.measurementId);
      if (!measurement) {
        clearHighlight();
        viewer.selectedEntity = undefined;
        return;
      }

      highlightPolygonSelection(measurement);
      viewer.selectedEntity = undefined;
      return;
    }

    if (entity.measureMeta.kind === "final-polygon") {
      const measurement = measurementById.get(entity.measureMeta.measurementId);
      if (!measurement) {
        clearHighlight();
        return;
      }

      highlightPolygonSelection(measurement);
      return;
    }

    if (entity.measureMeta.kind === "final-edge") {
      const measurement = measurementById.get(entity.measureMeta.measurementId);
      if (!measurement) {
        clearHighlight();
        return;
      }

      highlightEdgeSelection(measurement, entity);
      return;
    }

    clearHighlight();
  }

  // ---------------------------------------------------------------------------
  // Explicit click handler for finalized measurements
  //
  // Important:
  // This is the key fix for permanent label clicks. We explicitly pick the
  // clicked primitive/entity and route label clicks to polygon highlighting.
  // ---------------------------------------------------------------------------
  function installFinalizedMeasurementClickHandler() {
    if (finalizedClickHandler) return;

    finalizedClickHandler = new ScreenSpaceEventHandler(viewer.canvas);

    finalizedClickHandler.setInputAction((movement) => {
      // Do not process finalized-entity picking while sketching
      if (isDrawing) return;

      const picked = viewer.scene.pick(movement.position);
      if (!picked || !picked.id) return;

      const entity = picked.id;
      const meta = entity.measureMeta;

      if (!meta || meta.tool !== "area") return;

      // Clicking the permanent label highlights the parent polygon
      if (meta.kind === "final-label") {
        const measurement = measurementById.get(meta.measurementId);
        if (!measurement) {
          clearHighlight();
          viewer.selectedEntity = undefined;
          return;
        }

        highlightPolygonSelection(measurement);
        viewer.selectedEntity = measurement.polygon;
        return;
      }

      // Clicking the polygon directly also highlights it immediately
      if (meta.kind === "final-polygon") {
        const measurement = measurementById.get(meta.measureMeta?.measurementId || meta.measurementId);
        if (!measurement) {
          clearHighlight();
          return;
        }

        highlightPolygonSelection(measurement);
        return;
      }

      // Clicking an edge highlights both edge and polygon immediately
      if (meta.kind === "final-edge") {
        const measurement = measurementById.get(meta.measurementId);
        if (!measurement) {
          clearHighlight();
          return;
        }

        highlightEdgeSelection(measurement, entity);
        return;
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  // ---------------------------------------------------------------------------
  // UI events
  // ---------------------------------------------------------------------------
  startBtn.addEventListener("click", () => {
    if (isDrawing) {
      stopDrawing();
    } else {
      startDrawing();
    }
  });

  clearBtn.addEventListener("click", clearAll);

  // ---------------------------------------------------------------------------
  // Install global listeners for this tool instance
  // ---------------------------------------------------------------------------
  installFinalizedMeasurementClickHandler();
  viewer.selectedEntityChanged.addEventListener(onSelectedEntityChanged);

  // Stop an unfinished sketch if the panel gets hidden
  panelObserver = new MutationObserver(() => {
    if (getComputedStyle(panel).display === "none" && isDrawing) {
      stopDrawing();
    }
  });

  panelObserver.observe(panel, {
    attributes: true,
    attributeFilter: ["style"]
  });

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  const api = {
    stop: stopDrawing,

    destroy() {
      stopDrawing();
      clearHighlight();

      measurements.forEach(removeMeasurement);
      measurements.length = 0;
      measurementById.clear();

      if (finalizedClickHandler) {
        finalizedClickHandler.destroy();
        finalizedClickHandler = null;
      }

      if (panelObserver) {
        panelObserver.disconnect();
        panelObserver = null;
      }

      viewer.selectedEntityChanged.removeEventListener(onSelectedEntityChanged);

      if (viewer.selectedEntity?.measureMeta?.tool === "area") {
        viewer.selectedEntity = undefined;
      }

      if (body.parentNode === panel) {
        panel.removeChild(body);
      }

      if (viewer.__measureAreaApi === api) {
        delete viewer.__measureAreaApi;
      }
    }
  };

  viewer.__measureAreaApi = api;
  return api;
}