import proj4 from "proj4";
import { Chart } from "chart.js/auto";
import "./style.css";
import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartesian3,
  Ellipsoid,
  sampleTerrainMostDetailed,
  Cartographic,
  LabelStyle,
  Color,
  PolylineGlowMaterialProperty,
  Math as CesiumMath
} from "cesium";

/**
 * Initialize the Terrain Profile tool.
 *
 * Features:
 *  - User clicks two points in the 3D scene to define a profile line
 *  - Samples terrain heights along the line (equidistant points or fixed spacing)
 *  - Computes both 3D (draped) and planar distances
 *  - Renders elevation profiles with Chart.js (3D, planar, or both)
 *  - Supports multiple profiles (G1, G2, ...) with selection and deletion
 *  - Exports the active profile to CSV in a chosen coordinate system (proj4)
 *
 * @param {HTMLElement} panel - The panel element where the UI is rendered
 * @param {Viewer} viewer - Cesium Viewer instance
 * @param {Array} proj4Defs - Array of CRS definitions for proj4 (code, projection, alias, label)
 */
export default function initTerrainSection(panel, viewer, proj4Defs) {
  // Validate proj4 definitions
  if (!Array.isArray(proj4Defs) || proj4Defs.length === 0) {
    console.warn("initTerrainSection: proj4Defs saknas eller är inte en array");
    return () => {};
  }

  // Register proj4 definitions (main code + optional alias)
  proj4Defs.forEach(def => {
    proj4.defs(def.code, def.projection);
    if (def.alias) proj4.defs(def.alias, def.projection);
  });

  // Currently active CRS for export
  let activeCrs = proj4Defs[0];

  // Global unique counter for profile IDs (G1, G2, ...)
  let profileCounter = 0;
  function createNewProfileId() {
    profileCounter++;
    return "G" + profileCounter;
  }

  // ─────────────────────────────────────────────────────────────
  // UI: Panel header & body
  // ─────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = "Terrängprofil";
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "panel-body";
  panel.appendChild(body);

  // ─────────────────────────────────────────────────────────────
  // Main activate button
  // ─────────────────────────────────────────────────────────────
  const btn = document.createElement("button");
  btn.id = "terrain-section-btn";
  btn.textContent = "Aktivera";
  body.appendChild(btn);

  // Info button + tooltip explaining workflow
  const infoBtn = document.createElement("button");
  infoBtn.id = "terrain-section-infoBtn";
  infoBtn.className = "tool-button";
  infoBtn.style.setProperty("--icon", "var(--black-icon-info)");
  body.appendChild(infoBtn);

  const infoTooltip = document.createElement("div");
  infoTooltip.id = "terrain-section-infoTooltip";
  infoTooltip.innerHTML =
    "1. Välj metod för punktplacering <br> 2. Specificera antal punkter eller punktmellanrum <br>3. Tryck Aktivera och placera ut två punkter <br>4. Har flera grafer ritats kan man välja graf att visa under Graf-index <br> 5. Grafer går att radera <br>6. Vid export, exporteras vald graf i Graf-index <br><br>Noggrannheten beror på terrängens detaljnivå, kamerans zoom och att terrängen hunnit laddas färdigt innan mätning.";
  infoTooltip.style.display = "none";
  body.appendChild(infoTooltip);

  infoBtn.addEventListener("mouseenter", () => {
    infoTooltip.style.display = "block";
    // small delay for fade-in
    requestAnimationFrame(() => {
      infoTooltip.style.opacity = "1";
    });
  });

  infoBtn.addEventListener("mouseleave", () => {
    infoTooltip.style.opacity = "0";
    setTimeout(() => {
      infoTooltip.style.display = "none";
    }, 150);
  });

  // ─────────────────────────────────────────────────────────────
  // Sampling mode: equidistant vs spacing
  // ─────────────────────────────────────────────────────────────
  const modeLabel = document.createElement("label");
  modeLabel.textContent = "Metod för punktplacering:";
  modeLabel.style.display = "block";
  modeLabel.style.marginTop = "10px";
  body.appendChild(modeLabel);

  const radioEquidistant = document.createElement("input");
  radioEquidistant.type = "radio";
  radioEquidistant.name = "pointMode";
  radioEquidistant.value = "equidistant";
  radioEquidistant.checked = true;

  const radioEquidistantLabel = document.createElement("label");
  radioEquidistantLabel.textContent = " Ekvidistanta punkter";
  radioEquidistantLabel.style.marginLeft = "5px";

  body.appendChild(radioEquidistant);
  body.appendChild(radioEquidistantLabel);
  body.appendChild(document.createElement("br"));

  const radioSpacing = document.createElement("input");
  radioSpacing.type = "radio";
  radioSpacing.name = "pointMode";
  radioSpacing.value = "spacing";

  const radioSpacingLabel = document.createElement("label");
  radioSpacingLabel.textContent = " Punktmellanrum (meter)";
  radioSpacingLabel.style.marginLeft = "5px";

  body.appendChild(radioSpacing);
  body.appendChild(radioSpacingLabel);
  body.appendChild(document.createElement("br"));

  // Shared input: either number of points or spacing in meters
  const spacingInput = document.createElement("input");
  spacingInput.type = "number";
  spacingInput.min = "1";
  spacingInput.step = "0.1";
  spacingInput.style.width = "97%";
  spacingInput.style.marginTop = "5px";
  spacingInput.placeholder = "Antal punkter eller meter";
  body.appendChild(spacingInput);

  function getSelectedMode() {
    return document.querySelector("input[name='pointMode']:checked").value;
  }

  function updatePlaceholder() {
    if (getSelectedMode() === "equidistant") {
      spacingInput.placeholder = "Antal punkter (heltal)";
      spacingInput.step = "1";
      spacingInput.min = "2";
    } else {
      spacingInput.placeholder = "Punktmellanrum i meter (t.ex. 1.2)";
      spacingInput.step = "0.1";
      spacingInput.min = "0.1";
    }
  }

  radioEquidistant.addEventListener("change", updatePlaceholder);
  radioSpacing.addEventListener("change", updatePlaceholder);
  updatePlaceholder();

  // ─────────────────────────────────────────────────────────────
  // Graph mode: 3D, planar, or both
  // ─────────────────────────────────────────────────────────────
  const graphModeLabel = document.createElement("label");
  graphModeLabel.textContent = "Grafens avståndsmetod:";
  graphModeLabel.style.display = "block";
  graphModeLabel.style.marginTop = "10px";
  body.appendChild(graphModeLabel);

  const radioGraph3D = document.createElement("input");
  radioGraph3D.type = "radio";
  radioGraph3D.name = "graphMode";
  radioGraph3D.value = "3d";
  radioGraph3D.checked = true;

  const radioGraph3DLabel = document.createElement("label");
  radioGraph3DLabel.textContent = " 3D (draperad längd)";
  radioGraph3DLabel.style.marginLeft = "5px";

  body.appendChild(radioGraph3D);
  body.appendChild(radioGraph3DLabel);
  body.appendChild(document.createElement("br"));

  const radioGraphPlan = document.createElement("input");
  radioGraphPlan.type = "radio";
  radioGraphPlan.name = "graphMode";
  radioGraphPlan.value = "plan";

  const radioGraphPlanLabel = document.createElement("label");
  radioGraphPlanLabel.textContent = " Kartesisk (horisontellt avstånd)";
  radioGraphPlanLabel.style.marginLeft = "5px";

  body.appendChild(radioGraphPlan);
  body.appendChild(radioGraphPlanLabel);
  body.appendChild(document.createElement("br"));

  const radioGraphBoth = document.createElement("input");
  radioGraphBoth.type = "radio";
  radioGraphBoth.name = "graphMode";
  radioGraphBoth.value = "both";

  const radioGraphBothLabel = document.createElement("label");
  radioGraphBothLabel.textContent = " Överlagring (3D + Kartesisk)";
  radioGraphBothLabel.style.marginLeft = "5px";

  body.appendChild(radioGraphBoth);
  body.appendChild(radioGraphBothLabel);
  body.appendChild(document.createElement("br"));

  function getGraphMode() {
    return document.querySelector("input[name='graphMode']:checked").value;
  }

  // ─────────────────────────────────────────────────────────────
  // Graph index dropdown (active profile)
  // ─────────────────────────────────────────────────────────────
  const graphSelectLabel = document.createElement("label");
  graphSelectLabel.textContent = "Graf-index:";
  graphSelectLabel.style.display = "block";
  graphSelectLabel.style.marginTop = "10px";
  body.appendChild(graphSelectLabel);

  const graphSelect = document.createElement("select");
  graphSelect.style.width = "100%";
  graphSelect.style.marginTop = "5px";
  graphSelect.disabled = true;
  body.appendChild(graphSelect);

  graphSelect.addEventListener("change", () => {
    const id = graphSelect.value;
    if (id) setActiveProfile(id);
  });

  // ─────────────────────────────────────────────────────────────
  // Delete profile dropdown + button
  // ─────────────────────────────────────────────────────────────
  const deleteLabel = document.createElement("label");
  deleteLabel.textContent = "Graf att radera:";
  deleteLabel.style.display = "block";
  deleteLabel.style.marginTop = "10px";
  body.appendChild(deleteLabel);

  const deleteSelect = document.createElement("select");
  deleteSelect.style.width = "100%";
  deleteSelect.style.marginTop = "5px";
  deleteSelect.disabled = true;
  body.appendChild(deleteSelect);

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Radera vald graf";
  deleteBtn.style.marginTop = "5px";
  deleteBtn.disabled = true;
  body.appendChild(deleteBtn);

  // ─────────────────────────────────────────────────────────────
  // CRS selection for export
  // ─────────────────────────────────────────────────────────────
  const crsLabel = document.createElement("label");
  crsLabel.textContent = "Koordinatsystem för export:";
  crsLabel.style.display = "block";
  crsLabel.style.marginTop = "10px";
  body.appendChild(crsLabel);

  const crsSelect = document.createElement("select");
  crsSelect.style.width = "100%";
  crsSelect.style.marginTop = "5px";
  body.appendChild(crsSelect);

  proj4Defs.forEach(def => {
    const opt = document.createElement("option");
    opt.value = def.code;
    opt.textContent = def.label || def.code;
    crsSelect.appendChild(opt);
  });

  crsSelect.value = activeCrs.code;

  crsSelect.addEventListener("change", () => {
    activeCrs = proj4Defs.find(def => def.code === crsSelect.value);
  });

  // ─────────────────────────────────────────────────────────────
  // Export button
  // ─────────────────────────────────────────────────────────────
  const exportBtn = document.createElement("button");
  exportBtn.textContent = "Exportera grafdata till .csv";
  exportBtn.style.marginTop = "10px";
  exportBtn.disabled = true;
  body.appendChild(exportBtn);

  // ─────────────────────────────────────────────────────────────
  // Graph container (multiple canvases stacked)
  // ─────────────────────────────────────────────────────────────
  const graphContainer = document.createElement("div");
  graphContainer.style.position = "relative";
  graphContainer.style.width = "100%";
  graphContainer.style.height = "220px";
  graphContainer.style.border = "1px solid #444";
  graphContainer.style.marginTop = "10px";
  body.appendChild(graphContainer);

  // ─────────────────────────────────────────────────────────────
  // Profile storage and helpers
  // ─────────────────────────────────────────────────────────────
  let profiles = [];
  let activeProfileId = null;

  function addProfileToDropdowns(id) {
    const opt1 = document.createElement("option");
    opt1.value = id;
    opt1.textContent = id;
    graphSelect.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = id;
    opt2.textContent = id;
    deleteSelect.appendChild(opt2);

    graphSelect.disabled = false;
    deleteSelect.disabled = false;
    deleteBtn.disabled = false;
    exportBtn.disabled = false;
  }

  function removeProfileFromDropdowns(id) {
    [...graphSelect.options].forEach(o => {
      if (o.value === id) graphSelect.removeChild(o);
    });
    [...deleteSelect.options].forEach(o => {
      if (o.value === id) deleteSelect.removeChild(o);
    });

    if (graphSelect.options.length === 0) {
      graphSelect.disabled = true;
      deleteSelect.disabled = true;
      deleteBtn.disabled = true;
      exportBtn.disabled = true;
    }
  }

  function createProfileCanvas(id) {
    const canvas = document.createElement("canvas");
    canvas.id = "canvas-" + id;
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "none";

    graphContainer.appendChild(canvas);
    return canvas;
  }

  function setActiveProfile(id) {
    activeProfileId = id;
    graphSelect.value = id;

    profiles.forEach(p => {
      const c = document.getElementById("canvas-" + p.id);
      if (c) c.style.display = "none";
    });

    const activeCanvas = document.getElementById("canvas-" + id);
    if (activeCanvas) activeCanvas.style.display = "block";

    const p = profiles.find(p => p.id === id);
    if (p) {
      drawElevationChart(
        p.cartesianPositions,
        p.heights,
        p.swerefPoints,
        p.canvas,
        p
      );
    }
  }

  /**
   * Build and render the elevation chart for a profile.
   * Uses Chart.js and supports 3D, planar, or both distance modes.
   */
  function drawElevationChart(
    cartesianPositions,
    heights,
    swerefPoints,
    canvas,
    profile
  ) {
    const mode = getGraphMode();

    const distances3D = [];
    const distancesPlan = [];
    const heightValues = [];

    let total3D = 0;
    let totalPlan = 0;

    for (let i = 0; i < cartesianPositions.length; i++) {
      if (i > 0) {
        const d3 = Cartesian3.distance(
          cartesianPositions[i - 1],
          cartesianPositions[i]
        );
        total3D += d3;

        const p1 = swerefPoints[i - 1];
        const p2 = swerefPoints[i];
        const dPlan = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        totalPlan += dPlan;
      }

      distances3D.push(total3D);
      distancesPlan.push(totalPlan);
      heightValues.push(heights[i]);
    }

    let labels;
    let datasets = [];

    if (mode === "3d") {
      labels = distances3D.map(v => v.toFixed(2));
      datasets.push({
        label: profile.id + " – 3D (draperad längd)",
        data: heightValues.map(v => v.toFixed(2)),
        borderColor: "rgba(0, 200, 255, 1)",
        backgroundColor: "rgba(0, 200, 255, 0.2)",
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: "rgba(255, 255, 255, 1)"
      });
    } else if (mode === "plan") {
      labels = distancesPlan.map(v => v.toFixed(2));
      datasets.push({
        label: profile.id + " – Kartesisk (horisontellt avstånd)",
        data: heightValues.map(v => v.toFixed(2)),
        borderColor: "rgba(255, 150, 0, 1)",
        backgroundColor: "rgba(255, 150, 0, 0.2)",
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: "rgba(255, 255, 255, 1)"
      });
    } else if (mode === "both") {
      labels = distancesPlan.map(v => v.toFixed(2));

      datasets.push({
        label: profile.id + " – 3D (draperad längd)",
        data: heightValues.map(v => v.toFixed(2)),
        borderColor: "rgba(0, 200, 255, 1)",
        backgroundColor: "rgba(0, 200, 255, 0.2)",
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: "rgba(255, 255, 255, 1)"
      });

      datasets.push({
        label: profile.id + " – Kartesisk (horisontellt avstånd)",
        data: heightValues.map(v => v.toFixed(2)),
        borderColor: "rgba(255, 150, 0, 1)",
        backgroundColor: "rgba(255, 150, 0, 0.2)",
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: "rgba(255, 255, 255, 1)"
      });
    }

    if (profile.chartInstance) profile.chartInstance.destroy();

    profile.chartInstance = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets
      },
      options: {
        responsive: true,
        plugins: {
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const idx = ctx.dataIndex;
                const h = heightValues[idx].toFixed(2);

                if (ctx.dataset.label.includes("3D")) {
                  const d = distances3D[idx].toFixed(2);
                  return `3D: ${d} m, höjd: ${h} m`;
                } else {
                  const d = distancesPlan[idx].toFixed(2);
                  return `Kartesisk: ${d} m, höjd: ${h} m`;
                }
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text:
                mode === "3d"
                  ? "Avstånd längs terrängen (m)"
                  : "Horisontellt avstånd (m)"
            }
          },
          y: {
            title: { display: true, text: "Höjd (m)" }
          }
        }
      }
    });

    // Store computed distances for later CSV export
    profile.distances3D = distances3D;
    profile.distancesPlan = distancesPlan;
    profile.heightValues = heightValues;
  }

  function redrawActiveProfile() {
    if (!activeProfileId) return;
    const p = profiles.find(p => p.id === activeProfileId);
    if (!p) return;
    drawElevationChart(
      p.cartesianPositions,
      p.heights,
      p.swerefPoints,
      p.canvas,
      p
    );
  }

  radioGraph3D.addEventListener("change", redrawActiveProfile);
  radioGraphPlan.addEventListener("change", redrawActiveProfile);
  radioGraphBoth.addEventListener("change", redrawActiveProfile);

  // ─────────────────────────────────────────────────────────────
  // CSV export of active profile
  // ─────────────────────────────────────────────────────────────
  exportBtn.addEventListener("click", () => {
    if (!activeProfileId) return;

    const p = profiles.find(p => p.id === activeProfileId);
    if (!p) return;

    const mode = getGraphMode();

    const distances3D = p.distances3D || [];
    const distancesPlan = p.distancesPlan || [];
    const heights = p.heightValues || p.heights || [];

    // Build coordinate list in chosen CRS
    const coords = [];
    for (let i = 0; i < p.cartesianPositions.length; i++) {
      const carto = Ellipsoid.WGS84.cartesianToCartographic(
        p.cartesianPositions[i]
      );
      const lon = CesiumMath.toDegrees(carto.longitude);
      const lat = CesiumMath.toDegrees(carto.latitude);

      if (activeCrs.code === "EPSG:4326") {
        coords.push({ lon, lat });
      } else {
        const [E, N] = proj4("EPSG:4326", activeCrs.code, [lon, lat]);
        coords.push({ E, N });
      }
    }

    const isWGS = activeCrs.code === "EPSG:4326";

    // Info text header
    let csv =
      "Terrängprofilspunkter exportarde från 3D-kartan. Notera att punkternas noggrannhet baseras på hur detaljerad terräng 3D-kartan använder samt hur nära inzoomad kameran är och att terräng låtits laddats färdigt innan påbörjad mätning.\n\n";

    // Column headers + data depending on mode
    if (mode === "3d") {
      csv += isWGS
        ? "index;distance_3d_m;height_m;lon_deg;lat_deg\n"
        : "index;distance_3d_m;height_m;E;N\n";

      for (let i = 0; i < heights.length; i++) {
        const d3 = (distances3D[i] || 0).toFixed(3);
        const h = heights[i].toFixed(3);

        if (isWGS) {
          csv += `${i};${d3};${h};${coords[i].lon.toFixed(
            6
          )};${coords[i].lat.toFixed(6)}\n`;
        } else {
          csv += `${i};${d3};${h};${coords[i].E.toFixed(
            3
          )};${coords[i].N.toFixed(3)}\n`;
        }
      }
    } else if (mode === "plan") {
      csv += isWGS
        ? "index;distance_plan_m;height_m;lon_deg;lat_deg\n"
        : "index;distance_plan_m;height_m;E;N\n";

      for (let i = 0; i < heights.length; i++) {
        const dp = (distancesPlan[i] || 0).toFixed(3);
        const h = heights[i].toFixed(3);

        if (isWGS) {
          csv += `${i};${dp};${h};${coords[i].lon.toFixed(
            6
          )};${coords[i].lat.toFixed(6)}\n`;
        } else {
          csv += `${i};${dp};${h};${coords[i].E.toFixed(
            3
          )};${coords[i].N.toFixed(3)}\n`;
        }
      }
    } else if (mode === "both") {
      csv += isWGS
        ? "index;distance_3d_m;distance_plan_m;height_m;lon_deg;lat_deg\n"
        : "index;distance_3d_m;distance_plan_m;height_m;E;N\n";

      for (let i = 0; i < heights.length; i++) {
        const d3 = (distances3D[i] || 0).toFixed(3);
        const dp = (distancesPlan[i] || 0).toFixed(3);
        const h = heights[i].toFixed(3);

        if (isWGS) {
          csv += `${i};${d3};${dp};${h};${coords[i].lon.toFixed(
            6
          )};${coords[i].lat.toFixed(6)}\n`;
        } else {
          csv += `${i};${d3};${dp};${h};${coords[i].E.toFixed(
            3
          )};${coords[i].N.toFixed(3)}\n`;
        }
      }
    }

    // Save CSV file with BOM for Excel compatibility
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const filename = `3D-kartan-${p.id}-${dateStr}.csv`;

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

  // ─────────────────────────────────────────────────────────────
  // Delete profile (graph + polyline + labels)
  // ─────────────────────────────────────────────────────────────
  deleteBtn.addEventListener("click", () => {
    const id = deleteSelect.value;
    if (!id) return;

    const index = profiles.findIndex(p => p.id === id);
    if (index === -1) return;

    const profile = profiles[index];

    const canvas = document.getElementById("canvas-" + id);
    if (canvas) canvas.remove();

    if (profile.chartInstance) profile.chartInstance.destroy();

    if (profile.polylineEntity) viewer.entities.remove(profile.polylineEntity);

    viewer.entities.values
      .filter(e => e.label && e.label.text && e.label.text.getValue() === id)
      .forEach(e => viewer.entities.remove(e));

    profiles.splice(index, 1);
    removeProfileFromDropdowns(id);

    if (profiles.length > 0) {
      setActiveProfile(profiles[0].id);
    } else {
      activeProfileId = null;
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Picking logic: click two points to define profile
  // ─────────────────────────────────────────────────────────────
  let active = false;
  let clickHandler = null;
  let points = [];
  let tempEntities = [];

  btn.addEventListener("click", () => {
    active = !active;
    btn.textContent = active ? "Avaktivera" : "Aktivera";

    if (active) {
      clearTempEntities();
      points = [];
      startPicking();
    } else {
      stopPicking();
      clearTempEntities();
    }
  });

  function startPicking() {
    clickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);

    clickHandler.setInputAction(async movement => {
      const earthPosition = viewer.scene.pickPosition(movement.position);
      if (!earthPosition) return;

      points.push(earthPosition);

      tempEntities.push(
        viewer.entities.add({
          position: earthPosition,
          point: { pixelSize: 10, color: Color.RED }
        })
      );

      if (points.length === 2) {
        await generateTerrainProfile(points[0], points[1]);
        points = [];
        clearTempEntities();
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  function stopPicking() {
    if (clickHandler) {
      clickHandler.destroy();
      clickHandler = null;
    }
  }

  function clearTempEntities() {
    tempEntities.forEach(e => viewer.entities.remove(e));
    tempEntities = [];
  }

  /**
   * Generate a terrain profile between two 3D points.
   *  - Builds sampling points (equidistant or spaced)
   *  - Samples terrain heights with sampleTerrainMostDetailed
   *  - Creates Cesium polyline + label
   *  - Registers a new profile and draws its chart
   */
  async function generateTerrainProfile(p1, p2) {
    clearTempEntities();

    const mode = getSelectedMode();
    const inputValue = parseFloat(spacingInput.value);

    let samples = [];
    let swerefPoints = [];

    if (mode === "equidistant") {
      if (isNaN(inputValue) || inputValue < 2 || !Number.isInteger(inputValue)) {
        alert("Antalet punkter måste vara ett heltal ≥ 2");
        return;
      }

      const totalPoints = inputValue;

      for (let i = 0; i < totalPoints; i++) {
        const t = i / (totalPoints - 1);
        const point = Cartesian3.lerp(p1, p2, t, new Cartesian3());
        const carto = Ellipsoid.WGS84.cartesianToCartographic(point);

        const lonDeg = CesiumMath.toDegrees(carto.longitude);
        const latDeg = CesiumMath.toDegrees(carto.latitude);
        const [xSw, ySw] = proj4("EPSG:4326", "EPSG:3006", [lonDeg, latDeg]);
        swerefPoints.push({ x: xSw, y: ySw });

        samples.push(new Cartographic(carto.longitude, carto.latitude));
      }
    } else if (mode === "spacing") {
      if (isNaN(inputValue) || inputValue <= 0) {
        alert("Punktmellanrum måste vara ett positivt tal");
        return;
      }

      const spacing = inputValue;

      const c1 = Ellipsoid.WGS84.cartesianToCartographic(p1);
      const c2 = Ellipsoid.WGS84.cartesianToCartographic(p2);

      const lon1 = CesiumMath.toDegrees(c1.longitude);
      const lat1 = CesiumMath.toDegrees(c1.latitude);
      const lon2 = CesiumMath.toDegrees(c2.longitude);
      const lat2 = CesiumMath.toDegrees(c2.latitude);

      const [x1, y1] = proj4("EPSG:4326", "EPSG:3006", [lon1, lat1]);
      const [x2, y2] = proj4("EPSG:4326", "EPSG:3006", [lon2, lat2]);

      const dx = x2 - x1;
      const dy = y2 - y1;

      const planarDistance = Math.hypot(dx, dy);

      const ux = dx / planarDistance;
      const uy = dy / planarDistance;

      let d = 0;
      const eps = 1e-6;

      while (d <= planarDistance + eps) {
        const x = x1 + ux * d;
        const y = y1 + uy * d;

        swerefPoints.push({ x, y });

        const [lonDeg, latDeg] = proj4("EPSG:3006", "EPSG:4326", [x, y]);

        samples.push(
          new Cartographic(
            CesiumMath.toRadians(lonDeg),
            CesiumMath.toRadians(latDeg)
          )
        );

        d += spacing;
      }
    }

    // Sample terrain heights at all sample positions
    const updated = await sampleTerrainMostDetailed(
      viewer.terrainProvider,
      samples
    );

    const cartesianPositions = [];
    const heights = [];

    updated.forEach((carto, index) => {
      const lonDeg = CesiumMath.toDegrees(carto.longitude);
      const latDeg = CesiumMath.toDegrees(carto.latitude);

      const [xProj, yProj] = proj4("EPSG:4326", activeCrs.code, [lonDeg, latDeg]);

      console.log(
        `Punkt ${index}: X=${xProj.toFixed(2)}, Y=${yProj.toFixed(
          2
        )}, Z=${carto.height.toFixed(2)}`
      );

      const pos = Cartesian3.fromRadians(
        carto.longitude,
        carto.latitude,
        carto.height
      );

      cartesianPositions.push(pos);
      heights.push(carto.height);

      tempEntities.push(
        viewer.entities.add({
          position: pos,
          point: { pixelSize: 8, color: Color.YELLOW }
        })
      );
    });

    // Add polyline in Cesium for the profile line
    const polylineEntity = viewer.entities.add({
      polyline: {
        positions: cartesianPositions,
        width: 4,
        material: new PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: Color.CYAN
        })
      }
    });

    // Unique profile ID
    const id = createNewProfileId();

    // Raise label 10 meters above ground at first point
    const firstCarto = Ellipsoid.WGS84.cartesianToCartographic(cartesianPositions[0]);
    const elevatedPos = Cartesian3.fromRadians(
      firstCarto.longitude,
      firstCarto.latitude,
      firstCarto.height + 10
    );

    viewer.entities.add({
      position: elevatedPos,
      label: {
        text: id,
        font: "24px sans-serif",
        fillColor: Color.WHITE,
        showBackground: true,
        backgroundColor: new Color(0.165, 0.165, 0.165, 0.8),
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: 0
      }
    });

    // Register profile in dropdowns
    addProfileToDropdowns(id);

    // Create canvas for this profile
    const canvas = createProfileCanvas(id);

    // Profile object storing all relevant data
    const profile = {
      id,
      cartesianPositions,
      heights,
      swerefPoints,
      canvas,
      chartInstance: null,
      polylineEntity,
      distances3D: [],
      distancesPlan: [],
      heightValues: []
    };

    profiles.push(profile);

    // Activate this profile and draw its chart
    setActiveProfile(id);

    console.log("Terrängprofil klar!");
  }

  /**
   * Stop the terrain tool:
   *  - Deactivate picking
   *  - Clear temporary entities
   *  - Reset state
   */
  function stopTerrainTool() {
    active = false;
    btn.textContent = "Aktivera";

    stopPicking();
    clearTempEntities();
    points = [];
  }

  // Stop the tool automatically if the panel is hidden
  const mo = new MutationObserver(() => {
    if (panel.style.display !== "block" && active) {
      stopTerrainTool();
    }
  });

  mo.observe(panel, { attributes: true, attributeFilter: ["style"] });
}
