// src/tools/forms/index.js

import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartographic,
  Math as CesiumMath,
  Color,
  HeightReference,
  defined,
  CustomDataSource,
  Cartesian3,
  VerticalOrigin,
  DistanceDisplayCondition,
  Cartesian2,
  LabelStyle,
  // Used as a terrain fallback when scene-based height sampling is unavailable.
  sampleTerrainMostDetailed,
} from "cesium";

import { Formio } from "@formio/js";

// Scoped Form.io styles. These are prefixed at build time so they only apply
// inside the `.forms-scope` container created below.
import "./formio.scoped.css";

// Additional scoped styles for this tool.
import "./bootstrap.scoped.css";
import "./style.css";

// Base URL injected at build time through webpack DefinePlugin.
// Example:
//   development -> http://localhost:4001
//   production  -> https://...
const apiBaseUrl = API_BASE_URL;
let currentFormVersionId = null;
/**
 * Normalizes tool configuration into a consistent array of form descriptors.
 *
 * Supported config shapes:
 *   1) { forms: [{ id, name }, ...] }
 *   2) { formId: "my-form" }
 *   3) { formId: ["form-a", "form-b"] }
 *
 * Returns:
 *   [{ id: "form-id", name: "Display Name" }, ...]
 *
 * This lets the rest of the tool work with one unified structure regardless
 * of how the configuration was written.
 */
function normalizeForms(toolConfig = {}) {
  if (Array.isArray(toolConfig.forms) && toolConfig.forms.length) {
    return toolConfig.forms
      .map((f) => ({
        id: f?.id,
        name: f?.name ?? f?.id ?? "Form",
      }))
      .filter((f) => typeof f.id === "string" && f.id.length > 0);
  }

  const ids =
    typeof toolConfig.formId === "string"
      ? [toolConfig.formId]
      : Array.isArray(toolConfig.formId)
        ? toolConfig.formId
        : [];

  return ids
    .filter((id) => typeof id === "string" && id.length > 0)
    .map((id) => ({ id, name: id }));
}

/**
 * Loads the published schema for a public form from the backend.
 *
 * The backend is expected to return a Form.io-compatible document containing
 * at least a `schema` property.
 *
 * Throws an Error if the request fails.
 */
// Was api-server
async function loadPublishedFormSchema(baseUrl, formId) {
  const res = await fetch(
    `${baseUrl}/3d-kartan/backend/public/forms/${encodeURIComponent(formId)}`
  );

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(json?.error || `Failed to load form (${res.status})`);
  }

  const form = json?.data;
  const schema = form?.activeVersion?.schema;
  const formVersionId = form?.activeVersion?.id;

  if (!schema || !formVersionId) {
    throw new Error("Form has no active schema/version");
  }

  return {
    formId: form.id,
    formVersionId,
    schema,
  };
}

/**
 * Converts a screen click into a world position on the map/globe.
 *
 * Strategy:
 *   1) Prefer Cesium depth-based picking (`pickPosition`) when supported,
 *      because it can hit 3D Tiles / geometry more accurately.
 *   2) Fall back to ray/globe intersection if depth picking is unavailable.
 *
 * Returns:
 *   - Cartesian3 world position, or
 *   - null if no valid ground position could be determined.
 */
function pickGroundPosition(viewer, windowPosition) {
  const scene = viewer.scene;

  // Preferred path: depth-based picking.
  if (scene.pickPositionSupported) {
    const picked = scene.pick(windowPosition);
    if (defined(picked)) {
      const cart = scene.pickPosition(windowPosition);
      if (defined(cart)) return cart;
    }
  }

  // Fallback path: ray cast to the globe.
  const ray = viewer.camera.getPickRay(windowPosition);
  if (!ray) return null;

  const cart = scene.globe.pick(ray, scene);
  return cart ?? null;
}

/**
 * Retrieves a stable ground height in meters for a longitude/latitude pair.
 *
 * Why this exists:
 *   Labels/billboards often behave more predictably when placed at an explicit
 *   height rather than using CLAMP_TO_GROUND. This helper samples the best
 *   available height source and returns a numeric elevation.
 *
 * Strategy:
 *   1) Try `scene.sampleHeightMostDetailed()` first if available.
 *      This works well when 3D Tiles / depth-based height sampling is present.
 *   2) Fall back to terrain sampling with `sampleTerrainMostDetailed()`.
 *   3) If both fail, use 0 meters.
 */
async function getGroundHeightMeters(viewer, lon, lat) {
  const scene = viewer.scene;
  const carto = Cartographic.fromDegrees(lon, lat);

  // Best-case path: sample visible scene/tiles height.
  if (typeof scene.sampleHeightMostDetailed === "function") {
    try {
      const res = await scene.sampleHeightMostDetailed([carto]);
      const h = res?.[0]?.height;
      if (defined(h) && Number.isFinite(h)) return h;
    } catch (_) {
      // Ignore and fall through to terrain sampling.
    }
  }

  // Fallback: terrain provider height.
  try {
    const updated = await sampleTerrainMostDetailed(viewer.terrainProvider, [carto]);
    const h = updated?.[0]?.height;
    if (defined(h) && Number.isFinite(h)) return h;
  } catch (_) {
    // Ignore and fall through to default.
  }

  return 0;
}

/**
 * Enforces a business rule: the user must place a point on the map before
 * the form can be submitted.
 *
 * This helper:
 *   - inserts a small warning message into the form DOM
 *   - disables submit buttons until a point exists
 *   - updates the UI whenever the form renders or changes
 *
 * Returns an object exposing `setUi()`, so outer code can refresh the submit
 * state after map interaction or manual form resets.
 */
function enforcePointRequired(form, getHasPoint) {
  // Create or reuse the warning element.
  let warn = form.element?.querySelector?.(".forms-tool-point-warning");
  if (!warn) {
    warn = document.createElement("div");
    warn.className = "forms-tool-point-warning";
    warn.style.cssText = "margin:8px 0;color:#b91c1c;font-size:12px;display:none;";
    warn.textContent = "Placera en punkt på kartan innan du skickar.";
    form.element?.appendChild(warn);
  }

  const setUi = () => {
    const ok = !!getHasPoint();

    // Show/hide warning text.
    warn.style.display = ok ? "none" : "block";

    // Disable/enable any submit buttons rendered by Form.io.
    const submitButtons = form.element?.querySelectorAll(
      'button[type="submit"], .btn[type="submit"]'
    );

    submitButtons?.forEach((b) => {
      b.disabled = !ok;
      b.title = ok ? "" : "Placera en punkt på kartan innan du skickar.";
    });
  };

  setUi();
  form.on("render", setUi);
  form.on("change", setUi);

  return { setUi };
}

/**
 * Adds a local "submitted here" marker to the map after a successful form
 * submission.
 *
 * Notes:
 *   - This marker is client-side only.
 *   - It is stored in a temporary Cesium DataSource.
 *   - It disappears on page reload.
 */
async function addSubmittedMarker(viewer, submittedDs, { lon, lat, formId, formName }) {
  const h = await getGroundHeightMeters(viewer, lon, lat);

  submittedDs.entities.add({
    id: `submitted:${formId}:${Date.now()}`,
    position: Cartesian3.fromDegrees(lon, lat, h),

    billboard: {
      image: "./images/icons/Blue_pin.png",
      scale: 0.05,
      verticalOrigin: VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: new DistanceDisplayCondition(0.0, 15000.0),
    },

    label: {
      text: formName,
      font: "18px sans-serif",
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -40),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: new DistanceDisplayCondition(0.0, 15000.0),
    },

    properties: {
      kind: "forms-submitted",
      formName,
      submittedAt: new Date().toISOString(),
    },
  });
}

/**
 * Loads a form schema, renders the Form.io form into the provided mount node,
 * and wires up submission behavior.
 *
 * Responsibilities:
 *   - fetch the schema from the backend
 *   - render the Form.io form
 *   - require a picked map point before submit
 *   - intercept submit and POST to your backend
 *   - emit Form.io submitDone / submitError events so button spinners and
 *     internal Form.io UI behave correctly
 *   - call `onSubmitted()` after success so outer code can update the map/UI
 *
 * Returns:
 *   { form, pointGuard }
 */
async function renderFormIntoMount({
  mountEl,
  baseUrl,
  formId,
  formName,
  getContext,
  getHasPoint,
  onSubmitted,
}) {
  mountEl.innerHTML = "Loading form...";

  const formDoc = await loadPublishedFormSchema(baseUrl, formId);

  mountEl.innerHTML = "";

  const form = await Formio.createForm(mountEl, formDoc.schema);

  // Guard that enables/disables submit depending on whether a map point exists.
  const pointGuard = enforcePointRequired(form, getHasPoint);

  // Important:
  // We intercept Form.io's submit flow and do our own POST request. Because of
  // that, we must emit Form.io lifecycle events manually so the submit button
  // spinner and error state are correctly resolved.
  form.on("submit", async (submission) => {
    submission?.preventDefault?.();

    try {
      // Stop immediately if no map point has been selected.
      if (!getHasPoint()) {
        alert("Placera en punkt på kartan innan du skickar.");
        pointGuard.setUi();

        form.emit("submitError", {
          message: "No point selected",
          errors: [{ message: "Placera en punkt på kartan innan du skickar." }],
        });
        return;
      }

      const ctx = getContext?.() ?? {};

      // Payload combines ordinary form data with map/context metadata.
      const payload = {
        formVersionId: formDoc.formVersionId,  // Has to be taken from loadPublishedFormSchema
        data: submission.data,
        featureId: ctx.featureId ?? null,
        layerId: ctx.layerId ?? null,
        clientMeta: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          source: "cesium-forms-tool",
        },
        location:
          ctx.lon != null && ctx.lat != null
            ? { lon: ctx.lon, lat: ctx.lat }
            : null,
      };
      // Was api-server
      const res = await fetch(
        `${baseUrl}/3d-kartan/backend/public/forms/${encodeURIComponent(formId)}/submissions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.error || `Submit failed (${res.status})`);
      }

      // Tell Form.io the custom submit flow finished successfully.
      form.emit("submitDone", {
        submission: { data: submission.data },
        result: json,
      });

      alert("Tack! Ditt svar är sparat.");

      await onSubmitted?.({
        lon: ctx.lon,
        lat: ctx.lat,
        formId,
        formName,
        serverResult: json,
      });
    } catch (e) {
      console.error(e);

      // Tell Form.io the submit flow failed so it can stop spinners and show errors.
      form.emit("submitError", {
        message: e.message,
        errors: [{ message: e.message }],
      });

      alert(`Kunde inte skicka: ${e.message}`);
    } finally {
      // Always re-apply the point-required UI rules.
      pointGuard.setUi();
    }
  });

  pointGuard.setUi();
  return { form, pointGuard, formVersionId: formDoc.formVersionId };
}

/**
 * Creates or updates the temporary red dot showing the currently selected
 * click position on the map.
 *
 * This is different from submitted markers:
 *   - the red dot = "currently picked point"
 *   - the blue marker = "a form was submitted here"
 */
function upsertClickDot(viewer, state, cartesian) {
  if (!state.entity) {
    state.entity = viewer.entities.add({
      position: cartesian,
      point: {
        pixelSize: 12,
        color: Color.RED,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  } else {
    state.entity.position = cartesian;
  }
}

/**
 * Removes the temporary red click marker, if it exists.
 */
function removeClickDot(viewer, state) {
  if (state.entity) {
    viewer.entities.remove(state.entity);
    state.entity = null;
  }
}

/**
 * Initializes the Forms tool inside the given panel.
 *
 * High-level flow:
 *   1) Validate configuration
 *   2) Build panel DOM
 *   3) Load and render the selected form
 *   4) Let the user activate map-click mode
 *   5) Store the picked coordinate
 *   6) Require that point before submission
 *   7) After submit, add a local marker and clear the selection
 *
 * Parameters:
 *   panel      - DOM element used as the floating tool panel
 *   viewer     - Cesium Viewer instance
 *   toolConfig - toolbar/config entry for this tool
 */
export default function initForms(panel, viewer, toolConfig = {}) {
  // Fail early if webpack did not inject the API base URL.
  if (!apiBaseUrl) {
    throw new Error(
      "API_BASE_URL is missing. Ensure webpack DefinePlugin defines API_BASE_URL."
    );
  }

  const forms = normalizeForms(toolConfig);

  // Temporary in-memory datasource for "submitted here" markers.
  // These are not persisted and disappear on page reload.
  const submittedDs = new CustomDataSource("forms-submitted");
  viewer.dataSources.add(submittedDs);

  // ------------------------------------------------------------
  // 1) Panel header
  // ------------------------------------------------------------
  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = "Formulär";
  panel.appendChild(header);

  // ------------------------------------------------------------
  // 2) Panel body
  // ------------------------------------------------------------
  const body = document.createElement("div");
  body.className = "panel-body";
  panel.appendChild(body);

  // Everything inside this wrapper gets the scoped Form.io / Bootstrap styles.
  const scope = document.createElement("div");
  scope.className = "forms-scope";
  body.appendChild(scope);

  // If the tool is active but no forms are configured, show an empty state.
  if (!forms.length) {
    const empty = document.createElement("div");
    empty.className = "tool-empty";
    empty.textContent = "Inga formulär konfigurerade.";
    scope.appendChild(empty);
    return;
  }

  // ------------------------------------------------------------
  // 3) Coordinate readout
  // ------------------------------------------------------------
  // Displays the currently selected lon/lat to the user.
  const coordBox = document.createElement("div");
  coordBox.className = "forms-tool-coordinates";
  coordBox.style.cssText =
    "margin:8px 0;padding:8px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;font-size:12px;";
  scope.appendChild(coordBox);

  const coordTitle = document.createElement("div");
  coordTitle.style.cssText = "font-weight:600;margin-bottom:4px;";
  coordTitle.textContent = "Klickad position";
  coordBox.appendChild(coordTitle);

  const coordValue = document.createElement("div");
  coordValue.style.cssText =
    "font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;";
  coordBox.appendChild(coordValue);

  // ------------------------------------------------------------
  // 4) Action buttons
  // ------------------------------------------------------------
  const actions = document.createElement("div");
  actions.className = "tool-actions";
  scope.appendChild(actions);

  // Toggle click-picking mode on/off.
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "tool-btn";
  actions.appendChild(toggleBtn);

  // Clears current form values and currently picked point.
  // Does NOT remove already-submitted markers.
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "tool-btn";
  clearBtn.textContent = "Rensa";
  actions.appendChild(clearBtn);

  // ------------------------------------------------------------
  // 5) Form mount container
  // ------------------------------------------------------------
  const formContainer = document.createElement("div");
  formContainer.className = "forms-tool-formcontainer";
  scope.appendChild(formContainer);

  const formMount = document.createElement("div");
  formMount.className = "forms-tool-formmount";
  formContainer.appendChild(formMount);

  // ------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------

  // Currently selected form id (if multiple forms are configured).
  let selectedFormId = forms[0].id;

  function getSelectedFormName() {
    return forms.find((f) => f.id === selectedFormId)?.name ?? selectedFormId;
  }

  // Current map point state.
  const point = { has: false, lon: null, lat: null };

  // Holds the temporary red "picked point" entity.
  const dotState = { entity: null };

  // Controls whether click-picking is enabled.
  let isPicking = false;
  let handler = undefined;

  // Current Form.io instance and its point-required UI helper.
  // Keeping references allows us to update the current form without recreating
  // it on every map click.
  let currentForm = null;
  let currentPointGuard = null;

  /**
   * Refreshes the coordinate display box based on the current point state.
   */
  function updateCoordReadout() {
    if (!point.has) {
      coordValue.textContent = "Ingen punkt vald";
    } else {
      coordValue.textContent = `lon: ${point.lon.toFixed(6)}, lat: ${point.lat.toFixed(6)}`;
    }
  }

  updateCoordReadout();

  // Small getters passed into render/submission helpers.
  const getHasPoint = () => point.has;
  const getContext = () => ({ lon: point.lon, lat: point.lat });

  /**
   * Loads and renders the currently selected form into the panel.
   *
   * On successful submission:
   *   - adds a local submitted marker
   *   - clears the picked point
   *   - removes the red click dot
   *   - updates the coordinate readout
   *   - disables submit again until a new point is picked
   */
  async function render() {
    const res = await renderFormIntoMount({
      mountEl: formMount,
      baseUrl: apiBaseUrl,
      formId: selectedFormId,
      formName: getSelectedFormName(),
      getContext,
      getHasPoint,
      onSubmitted: async ({ lon, lat, formId, formName }) => {
        if (lon != null && lat != null) {
          await addSubmittedMarker(viewer, submittedDs, { lon, lat, formId, formName });
        }

        // Clear current point selection after successful submit.
        point.has = false;
        point.lon = null;
        point.lat = null;
        removeClickDot(viewer, dotState);
        updateCoordReadout();

        // Re-disable submit until a new point is selected.
        currentPointGuard?.setUi?.();
      },
    });

    currentForm = res.form;
    currentPointGuard = res.pointGuard;
    currentFormVersionId = res.formVersionId;
  }

  // ------------------------------------------------------------
  // Click-picking mode
  // ------------------------------------------------------------

  /**
   * Updates the toggle button label to reflect current picking state.
   */
  function updateToggleUi() {
    toggleBtn.textContent = isPicking ? "Inaktivera klickläge" : "Aktivera klickläge";
  }

  /**
   * Enables click-picking on the Cesium canvas.
   *
   * Each left click:
   *   - finds a ground position
   *   - converts it to lon/lat
   *   - stores it as the current point
   *   - creates/updates the red click marker
   *   - updates the submit enabled/disabled state
   *
   * Note: the form is NOT re-rendered on click. Only the point-dependent UI is
   * refreshed, which is much more efficient.
   */
  function startPicking() {
    if (isPicking) return;
    isPicking = true;

    handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((click) => {
      const cartesian = pickGroundPosition(viewer, click.position);
      if (!cartesian) return;

      const cartographic = Cartographic.fromCartesian(cartesian);

      point.lon = CesiumMath.toDegrees(cartographic.longitude);
      point.lat = CesiumMath.toDegrees(cartographic.latitude);
      point.has = true;

      upsertClickDot(viewer, dotState, cartesian);
      updateCoordReadout();

      // Only refresh submit state; do not recreate the form.
      currentPointGuard?.setUi?.();
    }, ScreenSpaceEventType.LEFT_CLICK);

    updateToggleUi();
  }

  /**
   * Disables click-picking and destroys the Cesium input handler.
   */
  function stopPicking() {
    if (!isPicking) return;
    isPicking = false;

    if (handler) {
      handler.destroy();
      handler = undefined;
    }

    updateToggleUi();
  }

  // Toggle click-picking mode manually.
  toggleBtn.addEventListener("click", () => {
    if (isPicking) stopPicking();
    else startPicking();
  });

  /**
   * Clears the current form input values and current picked point.
   *
   * This is a manual reset initiated by the user.
   * It does not delete already-submitted map markers.
   */
  function clearAll() {
    if (currentForm) {
      currentForm.resetValue();
      currentForm.redraw?.();
    }

    point.has = false;
    point.lon = null;
    point.lat = null;
    removeClickDot(viewer, dotState);
    updateCoordReadout();

    currentPointGuard?.setUi?.();
  }

  clearBtn.addEventListener("click", clearAll);

  updateToggleUi();

  // ------------------------------------------------------------
  // Form selector (only shown when multiple forms are configured)
  // ------------------------------------------------------------
  if (forms.length > 1) {
    const row = document.createElement("div");
    row.className = "tool-row";
    scope.insertBefore(row, actions);

    const label = document.createElement("label");
    label.className = "tool-label";
    label.textContent = "Formulär";
    row.appendChild(label);

    const select = document.createElement("select");
    select.className = "tool-select";

    forms.forEach((f, idx) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name || `Formulär ${idx + 1}`;
      select.appendChild(opt);
    });

    select.value = selectedFormId;

    select.addEventListener("change", async () => {
      selectedFormId = select.value;

      // When switching forms, clear the old picked point so users do not
      // accidentally submit a new form with the previous form's location.
      point.has = false;
      point.lon = null;
      point.lat = null;
      removeClickDot(viewer, dotState);
      updateCoordReadout();

      // The new form may have a different schema, so drop previous references
      // and create a fresh Form.io instance.
      currentForm = null;
      currentPointGuard = null;

      try {
        await render();
      } catch (e) {
        console.error(e);
        formMount.innerHTML = `<div class="tool-empty">Kunde inte ladda formulär.</div>`;
      }
    });

    row.appendChild(select);
  }

  // ------------------------------------------------------------
  // Initial form render
  // ------------------------------------------------------------
  render().catch((e) => {
    console.error(e);
    formMount.innerHTML = `<div class="tool-empty">Kunde inte ladda formulär.</div>`;
  });

  // ------------------------------------------------------------
  // Auto-stop click-picking when the panel is hidden
  // ------------------------------------------------------------
  // This prevents invisible tools from continuing to listen to map clicks.
  const mo = new MutationObserver(() => {
    if (getComputedStyle(panel).display === "none" && isPicking) {
      stopPicking();
    }
  });

  mo.observe(panel, { attributes: true, attributeFilter: ["style"] });
}