// tools/placement/index.js

import {
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  defined,
  Math as CesiumMath,
  HeadingPitchRoll,
  HeadingPitchRange,
  Transforms,
  Quaternion,
  JulianDate,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  VerticalOrigin,
  HorizontalOrigin,
  LabelStyle,
  DistanceDisplayCondition,
  Model
} from "cesium";
import {
  LIMITS,
  clamp,
  normalizeDegrees,
  resolveSameOriginUrl,
  validateLocalModelFile,
  parseSavedState,
  normalizeSavedPlacement
} from "./validation.js";
import "./style.css";

// Dropdown value of the "choose own object" row. Never a valid model id.
const LOCAL_MODEL_OPTION_VALUE = "__select_local_model__";

// Alpha used for the placement preview and for a model while it is moved.
// Translucent models are not part of the depth buffer used by pickPosition,
// so they cannot be picked by their own pointer.
const GHOST_ALPHA = 0.55;
const LOCAL_MODEL_PREFLIGHT_TIMEOUT_MS = 30000;
/**
 * Returns a list of valid placement models based on the tool configuration.
 *
 * A valid model requires:
 *  - A non-empty "label" string
 *  - A non-empty "src" string pointing to the model URL
 */
// List moved to index.json for easier config.
function getPlacementModels(toolConfig) {
  const configuredModels = Array.isArray(toolConfig?.models)
    ? toolConfig.models
    : [];

  const validModels = [];
  const labels = new Set();
  const ids = new Set();
  const sources = new Set();

  for (const [index, model] of configuredModels.entries()) {
    const id = typeof model?.id === "string"
      ? model.id.trim()
      : "";

    const label = typeof model?.label === "string"
      ? model.label.trim()
      : "";

    const src = typeof model?.src === "string"
      ? model.src.trim()
      : "";

    if (!id || !label || !src) {
      console.warn(
        `Placement model at index ${index} was ignored: ` +
        '"id", "label" and "src" must be non-empty strings.'
      );
      continue;
    }

    if (id === LOCAL_MODEL_OPTION_VALUE || ids.has(id)) {
      console.warn(
        `Placement model "${label}" was ignored: ` +
        `reserved or duplicate id "${id}".`
      );
      continue;
    }

    if (labels.has(label)) {
      console.warn(
        `Placement model "${label}" was ignored: ` +
        "duplicate labels are not allowed."
      );
      continue;
    }

    const resolvedHref = resolveSameOriginUrl(
      src,
      document.baseURI,
      window.location.origin
    );

    if (!resolvedHref) {
      console.warn(
        `Placement model "${label}" was ignored: ` +
        `"${src}" must be a valid http(s) URL on the same origin ` +
        "as the application."
      );
      continue;
    }

    if (sources.has(resolvedHref)) {
      console.warn(
        `Placement model "${label}" was ignored: ` +
        `"${src}" is already used by another model.`
      );
      continue;
    }

    let heightM = null;

    if (model?.heightM !== undefined) {
      if (
        typeof model.heightM === "number" &&
        Number.isFinite(model.heightM) &&
        model.heightM > 0
      ) {
        heightM = model.heightM;
      } else {
        console.warn(
          `Placement model "${label}" has an invalid "heightM". ` +
          "It must be a positive number. " +
          "Height display is disabled for this model."
        );
      }
    }

    ids.add(id);
    labels.add(label);
    sources.add(resolvedHref);

    validModels.push({
      id,
      label,
      src,
      heightM,
      isLocal: false
    });
  }

  return validModels;
}
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
export default function initPlacement(panel, viewer, toolConfig = {}) {
  const modelOptions = getPlacementModels(toolConfig);

  const allowLocalObjects =
    toolConfig?.["allow-local-objects"] === true;

  // Placement storage key
  const PLACEMENT_STORAGE_KEY = "cesium-placement-tool-state-v1";

  /*
   * Keeps track of blob URLs created for local models.
   * They must remain valid for as long as any placed entity uses them.
   */
  const localModelUrls = new Set();
  // ------------------------------------------------------------
  // Placement handler to not use the global handler
  // ------------------------------------------------------------
  const placementHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);

  //Changed to check for "flex" display instead of "block".
  const isPanelOpen = () => panel.style.display === "flex";

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

  const hasConfiguredModels = modelOptions.length > 0;
  const canSelectModel = hasConfiguredModels || allowLocalObjects;

  if (!canSelectModel) {
    const option = document.createElement("option");

    option.textContent = "Inga modeller konfigurerade";
    option.disabled = true;
    option.selected = true;

    select.appendChild(option);
    select.disabled = true;

    console.warn(
      'Placement tool is active, but no valid "models" entries were found ' +
      'and "allow-local-objects" is not enabled.'
    );
  } else {
    const fragment = document.createDocumentFragment();

    for (const { label, id } of modelOptions) {
      const option = document.createElement("option");

      option.value = id;
      option.textContent = label;

      fragment.appendChild(option);
    }

    if (allowLocalObjects) {
      const localOption = document.createElement("option");

      localOption.value = LOCAL_MODEL_OPTION_VALUE;
      localOption.textContent = "Välj eget objekt";

      fragment.appendChild(localOption);
    }

    select.appendChild(fragment);

    /*
    * If there are no configured models, show the local-file option,
    * but do not treat it as a usable model until a file is selected.
    */
  if (!hasConfiguredModels && allowLocalObjects) {
          select.value = LOCAL_MODEL_OPTION_VALUE;
        }
  }


  rowSelect.appendChild(select);
  body.appendChild(rowSelect);

  // ------------------------------------------------------------
  // Hidden input for selecting local glTF/GLB files
  // ------------------------------------------------------------
  const localModelInput = document.createElement("input");

  localModelInput.type = "file";
  localModelInput.accept = ".glb,.gltf,model/gltf-binary,model/gltf+json";
  localModelInput.hidden = true;

  // Allow selecting the same file again after a failed or cancelled attempt.
  localModelInput.addEventListener("click", () => {
    localModelInput.value = "";
  });

  body.appendChild(localModelInput);

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

  toggleBtn.disabled = !canSelectModel;
  if (!canSelectModel) {
    toggleBtn.title = "Inga modeller tillgängliga";
  }

  const clearAllBtn = document.createElement("button");
  clearAllBtn.textContent = "Radera alla";

  const clearLastBtn = document.createElement("button");
  clearLastBtn.textContent = "Radera senaste";

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Spara placering";

  const loadBtn = document.createElement("button");
  loadBtn.textContent = "Ladda placering";

  const deleteSaveBtn = document.createElement("button");
  deleteSaveBtn.textContent = "Ta bort sparat";

  rowButtons.appendChild(toggleBtn);
  rowButtons.appendChild(clearAllBtn);
  rowButtons.appendChild(clearLastBtn);
  rowButtons.appendChild(saveBtn);
  rowButtons.appendChild(loadBtn);
  rowButtons.appendChild(deleteSaveBtn);
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

  const editButtonRow = document.createElement("div");
  editButtonRow.className = "placement-edit-buttons";

  const moveBtn = document.createElement("button");
  moveBtn.textContent = "Flytta valt";
  moveBtn.disabled = true;

  const clearSelectedBtn = document.createElement("button");
  clearSelectedBtn.textContent = "Radera vald";
  clearSelectedBtn.disabled = true;
  clearSelectedBtn.title = "Välj ett objekt i kartan först";

  const toggleLabelsBtn = document.createElement("button");
  toggleLabelsBtn.textContent = "Visa etiketter";
  toggleLabelsBtn.title = "Visa objektens namn och nummer";
  toggleLabelsBtn.setAttribute("aria-pressed", "false");

  editButtonRow.appendChild(moveBtn);
  editButtonRow.appendChild(clearSelectedBtn);
  editButtonRow.appendChild(toggleLabelsBtn);

  editSection.appendChild(editButtonRow);

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
  let previewEntity = null;
  let editMode = null;
  let moveStartPosition = null;
  let movingEntity = null;
  let moveStartColor;
  let currentScale = parseFloat(scaleInput.value);
  let currentHeading = 0;

  let isLoadingPlacements = false;
  let isImportingLocalModel = false;

  // Id of the model that was last successfully selected in the dropdown.
  let lastValidModelId = modelOptions[0]?.id ?? null;

  // Maps "name|size|lastModified" of imported files to their model id.
  const localModelKeys = new Map();

  // Pointer moves are coalesced to at most one pick per animation frame.
  let pendingPointerPosition = null;
  let pointerFrameId = 0;

  /*
  * Labels start hidden. Set this to true if labels should be
  * visible when the tool starts.
  */
  let labelsVisible = false;

  /*
  * Stores the highest assigned number per model ID.
  *
  * Example:
  * tree-model => 3
  * bench-model => 2
  */
  const modelNumberCounters = new Map();

  /*
  * Placement-specific metadata.
  *
  * Entity => {
  *   placementId: string,
  *   modelId: string,
  *   modelType: "configured" | "local",
  *   modelLabel: string,
  *   objectNumber: number,
  *   displayName: string,
  *   baseHeightM: number | null,
  *   headingDegrees: number
  * }
  */
  const placementMetadata = new Map();

  // ------------------------------------------------------------
  // Utility functions for placement and model handling, model preview and height readout
  // ------------------------------------------------------------
  function getSelectedModel() {
    return modelOptions.find(
      (model) => model.id === select.value
    ) || null;
  }

  /**
   * Returns a display name without the final file extension.
   */
  function getFileBaseName(fileName) {
    const lastDotIndex = fileName.lastIndexOf(".");

    const baseName = lastDotIndex > 0
      ? fileName.slice(0, lastDotIndex)
      : fileName;

    return baseName.trim() || "Lokalt objekt";
  }

  /**
   * Produces a unique label for the dropdown.
   *
   * Examples:
   *   house.glb  -> house
   *   house.glb  -> house (2)
   */
  function createUniqueModelLabel(requestedLabel) {
    const usedLabels = new Set(
      modelOptions.map((model) => model.label)
    );

    if (!usedLabels.has(requestedLabel)) {
      return requestedLabel;
    }

    let suffix = 2;
    let candidate = `${requestedLabel} (${suffix})`;

    while (usedLabels.has(candidate)) {
      suffix += 1;
      candidate = `${requestedLabel} (${suffix})`;
    }

    return candidate;
  }

  /**
   * Loads the model once, off-screen, so a corrupt or unsupported file is
   * rejected with a clear message. Cesium entities only log load errors, so
   * this is the only point where a failure can be reported to the user.
   */
  async function preflightLocalModel(objectUrl) {
    const modelPromise = Model.fromGltfAsync({
      url: objectUrl,
      scene: viewer.scene,
      incrementallyLoadTextures: false
    });

    let timeoutId;

    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("timeout")),
        LOCAL_MODEL_PREFLIGHT_TIMEOUT_MS
      );
    });

    try {
      const model = await Promise.race([modelPromise, timeout]);
      model.destroy();
    } catch (error) {
      // A model that finishes loading after a timeout must still be freed.
      modelPromise.then((model) => model.destroy()).catch(() => {});

      console.error("Local model preflight failed:", error);

      throw new Error(
        error?.message === "timeout"
          ? "Modellen tog för lång tid att läsa in."
          : "Modellen kunde inte läsas in. Filen kan vara skadad " +
            "eller använda funktioner som inte stöds."
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function getLocalModelCount() {
    return modelOptions.filter((model) => model.isLocal).length;
  }

  function selectModel(modelId) {
    select.value = modelId;
    lastValidModelId = modelId;
    updatePreviewForSelectedModel();
  }

  /**
   * Restores the last valid dropdown selection, for example after the file
   * dialog was cancelled or the chosen file was rejected.
   */
  function restoreLastValidSelection() {
    const model =
      modelOptions.find((candidate) => candidate.id === lastValidModelId) ||
      modelOptions[0];

    if (model) {
      selectModel(model.id);
    } else {
      select.value = LOCAL_MODEL_OPTION_VALUE;
    }
  }

  function setLocalImportBusy(isBusy) {
    select.disabled = isBusy || !canSelectModel;
    toggleBtn.disabled = isBusy || !canSelectModel;
  }

  /**
   * Adds a local model to the internal model list and dropdown.
   */
  function addLocalModel(file, objectUrl, fileKey) {
    const label = createUniqueModelLabel(
      getFileBaseName(file.name)
    );

    const model = {
      id: crypto.randomUUID(),
      label,
      src: objectUrl,
      heightM: null,
      isLocal: true,
      originalFileName: file.name
    };

    modelOptions.push(model);
    localModelUrls.add(objectUrl);
    localModelKeys.set(fileKey, model.id);

    const option = document.createElement("option");

    option.value = model.id;
    option.textContent = label;

    /*
    * Insert the uploaded model immediately before
    * "Välj eget objekt".
    */
    const localPickerOption = Array.from(select.options).find(
      (item) => item.value === LOCAL_MODEL_OPTION_VALUE
    );

    if (localPickerOption) {
      select.insertBefore(option, localPickerOption);
    } else {
      select.appendChild(option);
    }

    selectModel(model.id);
  }

  function getGroundPosition(windowPosition) {
    if (viewer.scene.pickPositionSupported) {
      const pickedPosition = viewer.scene.pickPosition(windowPosition);

      if (defined(pickedPosition)) {
        return pickedPosition;
      }
    }

    const ray = viewer.camera.getPickRay(windowPosition);

    if (!defined(ray)) {
      return undefined;
    }

    return viewer.scene.globe.pick(ray, viewer.scene);
  }

  function getEntityScale(entity) {
    const scale = entity?.model?.scale?.getValue(JulianDate.now());

    return typeof scale === "number" && Number.isFinite(scale)
      ? scale
      : 1;
  }

  function getEntityHeading(entity) {
    const heading = placementMetadata.get(entity)?.headingDegrees;

    return Number.isFinite(heading) ? heading : 0;
  }

  /**
   * Orientation that points the model along the given heading in the local
   * east-north-up frame at `position`. It must be recomputed whenever the
   * position changes, otherwise the model tilts as it moves over the globe.
   */
  function computeOrientation(position, headingDegrees) {
    return Transforms.headingPitchRollQuaternion(
      position,
      new HeadingPitchRoll(
        CesiumMath.toRadians(headingDegrees),
        0,
        0
      )
    );
  }

  function setEntityPose(entity, position, headingDegrees) {
    entity.position = position;
    entity.orientation = computeOrientation(position, headingDegrees);
  }

    /**
 * Assigns the next number for a model.
 *
 * Uses the stable model ID as the counter key. Local models also have
 * session-specific IDs, so they can be numbered during the session.
 */
function getNextModelNumber(model) {
  const counterKey = model.id;

  const currentNumber =
    modelNumberCounters.get(counterKey) || 0;

  const nextNumber = currentNumber + 1;

  modelNumberCounters.set(
    counterKey,
    nextNumber
  );

  return nextNumber;
}

/**
 * Registers an already assigned number.
 *
 * Used when restoring saved placements so that newly placed models
 * continue after the highest loaded number.
 */
  function registerModelNumber(modelId, objectNumber) {
    if (
      typeof modelId !== "string" ||
      modelId.trim() === "" ||
      !Number.isInteger(objectNumber) ||
      objectNumber < 1
    ) {
      return;
    }

    const currentNumber =
      modelNumberCounters.get(modelId) || 0;

    if (objectNumber > currentNumber) {
      modelNumberCounters.set(
        modelId,
        objectNumber
      );
    }
  }

   /**
   * Converts one configured placed entity into JSON-safe data.
   *
   * Locally uploaded models are excluded because their temporary blob
   * URLs cannot be restored after the browser session ends.
   */
  function serializePlacedEntity(entity) {
    const metadata = placementMetadata.get(entity);

    if (!metadata) {
      return null;
    }

    if (metadata.modelType !== "configured") {
      return null;
    }

    const position = entity.position?.getValue(
      JulianDate.now()
    );

    if (!defined(position)) {
      return null;
    }

    const cartographic = Cartographic.fromCartesian(position);

    if (!defined(cartographic)) {
      return null;
    }

    return {
      placementId: metadata.placementId,
      modelId: metadata.modelId,
      objectNumber: metadata.objectNumber,
      displayName: metadata.displayName,

      position: {
        longitude: CesiumMath.toDegrees(
          cartographic.longitude
        ),

        latitude: CesiumMath.toDegrees(
          cartographic.latitude
        ),

        height: cartographic.height
      },

      scale: getEntityScale(entity),

      headingDegrees: Number.isFinite(
        metadata.headingDegrees
      )
        ? metadata.headingDegrees
        : 0
    };
  }

  /**
   * Creates the complete single saved state.
   */
  function createSavedPlacementState() {
    return {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),

      placements: placedEntities
        .map(serializePlacedEntity)
        .filter(Boolean)
    };
  }

  /*
   * localStorage can throw (blocked storage, private modes, quota), so
   * every access goes through these helpers.
   */
  const savedStorage = {
    read() {
      try {
        return {
          ok: true,
          value: window.localStorage.getItem(PLACEMENT_STORAGE_KEY)
        };
      } catch (error) {
        console.error("Kunde inte läsa sparad placering:", error);
        return { ok: false, value: null };
      }
    },

    write(serialized) {
      try {
        window.localStorage.setItem(PLACEMENT_STORAGE_KEY, serialized);
        return true;
      } catch (error) {
        console.error("Kunde inte spara placerade modeller:", error);
        return false;
      }
    },

    remove() {
      try {
        window.localStorage.removeItem(PLACEMENT_STORAGE_KEY);
        return true;
      } catch (error) {
        console.error("Kunde inte ta bort sparad placering:", error);
        return false;
      }
    }
  };

  const STORAGE_UNAVAILABLE_MESSAGE =
    "Webbläsarens lokala lagring är inte tillgänglig.";

  function countSavedPlacements(serialized) {
    try {
      const state = JSON.parse(serialized);

      return Array.isArray(state?.placements)
        ? state.placements.length
        : null;
    } catch {
      return null;
    }
  }

  function savePlacements() {
    const state = createSavedPlacementState();
    const savedCount = state.placements.length;

    const localPlacementCount = placedEntities.filter(
      (entity) =>
        placementMetadata.get(entity)?.modelType === "local"
    ).length;

    if (savedCount === 0) {
      window.alert(
        localPlacementCount > 0
          ? "Det finns inga objekt att spara. Lokalt uppladdade " +
            "objekt kan inte sparas."
          : "Det finns inga placerade objekt att spara."
      );

      return;
    }

    if (savedCount > LIMITS.MAX_SAVED_PLACEMENTS) {
      window.alert(
        `Det går att spara högst ${LIMITS.MAX_SAVED_PLACEMENTS} objekt.`
      );

      return;
    }

    const existing = savedStorage.read();

    if (!existing.ok) {
      window.alert(STORAGE_UNAVAILABLE_MESSAGE);
      return;
    }

    if (
      localPlacementCount > 0 &&
      !window.confirm(
        `${localPlacementCount} lokalt uppladdade objekt kan inte ` +
        "sparas eftersom originalfilerna endast är tillgängliga " +
        "under den aktuella sessionen.\n\n" +
        `Vill du spara de övriga ${savedCount} objekten?`
      )
    ) {
      return;
    }

    if (existing.value !== null) {
      const previousCount = countSavedPlacements(existing.value);

      const shouldOverwrite = window.confirm(
        "Det finns redan en sparad placering" +
        (previousCount === null ? "" : ` (${previousCount} objekt)`) +
        `. Vill du ersätta den med ${savedCount} objekt?`
      );

      if (!shouldOverwrite) {
        return;
      }
    }

    if (!savedStorage.write(JSON.stringify(state))) {
      window.alert("De placerade modellerna kunde inte sparas.");
      return;
    }

    window.alert(
      `${savedCount} objekt sparades lokalt i webbläsaren.`
    );
  }

  /**
   * Validates one saved placement without touching the scene. Returns the
   * data needed to create the entity, or null when it must be skipped.
   */
  function planSavedPlacement(savedPlacement, usedPlacementIds) {
    const model = modelOptions.find(
      (candidate) =>
        candidate.isLocal !== true &&
        candidate.id === savedPlacement?.modelId
    );

    if (!model) {
      console.warn(
        "Saved placement skipped: its model is not configured."
      );

      return null;
    }

    const normalized = normalizeSavedPlacement(
      savedPlacement,
      usedPlacementIds
    );

    if (!normalized) {
      console.warn("Saved placement skipped: invalid data.");
      return null;
    }

    return { model, ...normalized };
  }

  function addPlannedPlacement(plan) {
    const { model, scale, headingDegrees } = plan;

    const objectNumber =
      plan.objectNumber ?? getNextModelNumber(model);

    const displayName =
      plan.displayName ?? `${model.label}-${objectNumber}`;

    const position = Cartesian3.fromDegrees(
      plan.longitude,
      plan.latitude,
      plan.height
    );

    const entity = viewer.entities.add({
      name: displayName,

      position,
      orientation: computeOrientation(position, headingDegrees),

      model: {
        uri: model.src,
        scale
      },

      label: createHeightLabel(
        model.heightM,
        scale,
        false,
        displayName
      )
    });

    placementMetadata.set(entity, {
      placementId: plan.placementId,
      modelId: model.id,
      modelType: "configured",
      modelLabel: model.label,
      objectNumber,
      displayName,
      baseHeightM: model.heightM,
      headingDegrees
    });

    placedEntities.push(entity);

    return entity;
  }

  function removeAllPlacedEntities({
    resetCounters = true
  } = {}) {
    for (const entity of placedEntities) {
      placementMetadata.delete(entity);
      viewer.entities.remove(entity);
    }

    placedEntities = [];

    if (resetCounters) {
      modelNumberCounters.clear();
    }

    clearSelection();
  }
 
  function removeSelectedEntity() {
  if (!selectedEntity) {
    return;
  }

  const entityToRemove = selectedEntity;

  const entityIndex = placedEntities.indexOf(
    entityToRemove
  );

  if (entityIndex !== -1) {
    placedEntities.splice(entityIndex, 1);
  }

  placementMetadata.delete(entityToRemove);
  viewer.entities.remove(entityToRemove);

  clearSelection();
}

async function loadPlacements() {
  if (isLoadingPlacements) {
    return;
  }

  isLoadingPlacements = true;

  try {
    await loadPlacementsFromStorage();
  } finally {
    isLoadingPlacements = false;
  }
}

async function loadPlacementsFromStorage() {
  const stored = savedStorage.read();

  if (!stored.ok) {
    window.alert(STORAGE_UNAVAILABLE_MESSAGE);
    return;
  }

  if (stored.value === null) {
    window.alert("Det finns ingen sparad placering.");
    return;
  }

  let parsed;

  try {
    parsed = parseSavedState(stored.value);
  } catch (error) {
    console.error("Ogiltig sparad placeringsdata:", error);
    window.alert(error.message);
    return;
  }

  /*
   * Validate everything first. The current scene is only touched once
   * it is known that at least one saved object can be restored.
   */
  const usedPlacementIds = new Set();
  const plans = [];
  let skippedCount = parsed.truncatedCount;

  for (const savedPlacement of parsed.placements) {
    const plan = planSavedPlacement(
      savedPlacement,
      usedPlacementIds
    );

    if (plan) {
      plans.push(plan);
    } else {
      skippedCount += 1;
    }
  }

  if (plans.length === 0) {
    window.alert(
      "Inga sparade objekt kunde laddas eftersom modellerna saknas " +
      "eller datan är ogiltig. Nuvarande placeringar är oförändrade."
    );

    return;
  }

  /*
   * Loading replaces all currently placed objects.
   * Ask before changing anything in the scene.
   */
  if (placedEntities.length > 0) {
    const shouldReplace = window.confirm(
      "Genom att ladda in den sparade placeringen kommer " +
      "befintliga objekt att ersättas. Vill du fortsätta?"
    );

    if (!shouldReplace) {
      return;
    }
  }

  stopPlacement();
  removeAllPlacedEntities();

  /*
   * Register explicit numbers first so entries without a number
   * cannot be assigned a number that a later entry already has.
   */
  for (const plan of plans) {
    if (plan.objectNumber !== null) {
      registerModelNumber(plan.model.id, plan.objectNumber);
    }
  }

  /*
   * Keep a separate list of entities created by this load.
   * This prevents unrelated viewer entities from affecting
   * the calculated camera extent.
   */
  const loadedEntities = plans.map(addPlannedPlacement);

  await flyToPlacedEntities(loadedEntities);

  if (skippedCount > 0) {
    window.alert(
      `${loadedEntities.length} objekt laddades.\n\n` +
      `${skippedCount} objekt hoppades över eftersom ` +
      "modellen saknas, sparad data är ogiltig eller antalet " +
      "överstiger gränsen."
    );

    return;
  }

  window.alert(`${loadedEntities.length} objekt laddades.`);
}

async function flyToPlacedEntities(entities) {
  if (!Array.isArray(entities) || entities.length === 0) {
    return false;
  }

  const validEntities = entities.filter(
    (entity) =>
      defined(entity) &&
      viewer.entities.contains(entity)
  );

  if (validEntities.length === 0) {
    return false;
  }

  try {
    const didFly = await viewer.flyTo(validEntities, {
      duration: 1.5,

      /*
       * heading:
       *   0 means the camera view is aligned toward north.
       *
       * pitch:
       *   -35 degrees gives an angled overview rather than
       *   looking vertically downward.
       *
       * range:
       *   0 tells Cesium to calculate the distance required
       *   to contain the loaded entities.
       */
      offset: new HeadingPitchRange(
        CesiumMath.toRadians(0),
        CesiumMath.toRadians(-35),
        0
      )
    });

    return didFly === true;
  } catch (error) {
    console.warn(
      "Kunde inte zooma till den laddade placeringen:",
      error
    );

    return false;
  }
}

function deleteSavedPlacements() {
  const existing = savedStorage.read();

  if (!existing.ok) {
    window.alert(STORAGE_UNAVAILABLE_MESSAGE);
    return;
  }

  if (existing.value === null) {
    window.alert("Det finns ingen sparad placering.");
    return;
  }

  const shouldDelete = window.confirm(
    "Vill du ta bort den sparade placeringen?"
  );

  if (!shouldDelete) {
    return;
  }

  window.alert(
    savedStorage.remove()
      ? "Den sparade placeringen har tagits bort."
      : "Den sparade placeringen kunde inte tas bort."
  );
}

/**
 * Formats the scaled height of a model.
 *
 * @param {number|null} baseHeightM
 * @param {number} scale
 * @returns {string}
 */
function formatModelHeight(baseHeightM, scale) {
  if (
    typeof baseHeightM !== "number" ||
    !Number.isFinite(baseHeightM) ||
    typeof scale !== "number" ||
    !Number.isFinite(scale)
  ) {
    return "";
  }

  const scaledHeightM = baseHeightM * scale;

  return `Höjd: ${scaledHeightM.toLocaleString("sv-SE", {
    maximumFractionDigits: 2
  })} m`;
}

/**
 * Creates the complete placed-object label.
 *
 * Example:
 * Träd-2
 * Höjd: 12 m
 */
function formatPlacedModelLabel(
  displayName,
  baseHeightM,
  scale
) {
  const lines = [];

  if (
    typeof displayName === "string" &&
    displayName.trim() !== ""
  ) {
    lines.push(displayName.trim());
  }

  const heightText = formatModelHeight(
    baseHeightM,
    scale
  );

  if (heightText) {
    lines.push(heightText);
  }

  return lines.join("\n");
}

/**
 * Creates the Cesium label configuration used for model heights.
 *
 * The label uses the same position as the model entity. A pixel offset
 * places it visually above the model's anchor point.
 */
function createHeightLabel(
  baseHeightM,
  scale,
  isPreview = false,
  displayName = ""
) {
  const text = isPreview
    ? formatModelHeight(baseHeightM, scale)
    : formatPlacedModelLabel(
        displayName,
        baseHeightM,
        scale
      );

  return {
    text,

    /*
     * Preview and placed labels use the same visibility setting.
     */
    show: labelsVisible && text.length > 0,

    font: "14px sans-serif",

    style: LabelStyle.FILL_AND_OUTLINE,

    fillColor: isPreview
      ? Color.WHITE.withAlpha(0.75)
      : Color.WHITE,

    outlineColor: Color.BLACK,
    outlineWidth: 3,

    showBackground: true,

    backgroundColor: isPreview
      ? Color.BLACK.withAlpha(0.45)
      : Color.BLACK.withAlpha(0.7),

    backgroundPadding: new Cartesian2(7, 5),

    horizontalOrigin: HorizontalOrigin.CENTER,
    verticalOrigin: VerticalOrigin.BOTTOM,
    pixelOffset: new Cartesian2(0, -45),

    distanceDisplayCondition:
      new DistanceDisplayCondition(
        0,
        1000
      ),

    disableDepthTestDistance:
      Number.POSITIVE_INFINITY
  };
}

/**
 * Updates the height label of an already placed model.
 */
function updateEntityHeightLabel(entity) {
  if (!entity?.label) return;

  const metadata = placementMetadata.get(entity);

  if (!metadata) {
    entity.label.show = false;
    entity.label.text = "";
    return;
  }

  const text = formatPlacedModelLabel(
    metadata.displayName,
    metadata.baseHeightM,
    getEntityScale(entity)
  );

  entity.label.text = text;

  entity.label.show =
    labelsVisible && text.length > 0;
}

/**
 * Updates the label of the model placement preview.
 */
function updatePreviewHeightLabel() {
  if (!previewEntity?.label) return;

  const selectedModel = getSelectedModel();

  if (!selectedModel) {
    previewEntity.label.show = false;
    previewEntity.label.text = "";
    return;
  }

  const text = formatModelHeight(
    selectedModel.heightM,
    currentScale
  );

  previewEntity.label.text = text;

  previewEntity.label.show =
    labelsVisible && text.length > 0;
}

/**
 * *pplies the current label visibilit* setting to all entities.
 */
function updateAllLabelVisibility() {
  for (const entity of placedEntities) {
    updateEntityHeightLabel(entity);
  }

  updatePreviewHeightLabel();

  toggleLabelsBtn.textContent = labelsVisible
    ? "Göm etiketter"
    : "Visa etiketter";

  toggleLabelsBtn.title = labelsVisible
    ? "Dölj objektens namn och nummer"
    : "Visa objektens namn och nummer";

  toggleLabelsBtn.setAttribute(
    "aria-pressed",
    String(labelsVisible)
  );
}

/**
 *Switches labels between visible and hidden.
 */
function toggleLabels() {
  labelsVisible = !labelsVisible;
  updateAllLabelVisibility();
}


/**
 * Updates or recreates the preview after the selected model changes.
 */
function updatePreviewForSelectedModel() {
  const selectedModel = getSelectedModel();

  if (!selectedModel) return;

  if (!previewEntity) return;

  previewEntity.name =
    `${selectedModel.label} (förhandsvisning)`;

  previewEntity.model.uri = selectedModel.src;

  updatePreviewHeightLabel();
}
  
  function removePreview() {
    if (!previewEntity) return;
  
    viewer.entities.remove(previewEntity);
    previewEntity = null;
  }
  
  function createPreview(position) {
  const selectedModel = getSelectedModel();

  if (!selectedModel) return;

  previewEntity = viewer.entities.add({
    name: `${selectedModel.label} (förhandsvisning)`,

    position,

    model: {
      uri: selectedModel.src,
      scale: currentScale,
      color: Color.WHITE.withAlpha(GHOST_ALPHA)
    },

    label: createHeightLabel(
      selectedModel.heightM,
      currentScale,
      true
    )
  });
}
  
  function updatePreview(position) {
    if (!isPlacing) return;
  
    if (!defined(position)) {
      removePreview();
      return;
    }
  
    if (!previewEntity) {
      createPreview(position);
      return;
    }
  
    previewEntity.position = position;
  }
  
  function addPlacedModel(position) {
  const selectedModel = getSelectedModel();

  if (!selectedModel || !defined(position)) {
    return;
  }

  const objectNumber = getNextModelNumber(
    selectedModel
  );

  const displayName =
    `${selectedModel.label}-${objectNumber}`;

  const headingDegrees = 0;

  const entity = viewer.entities.add({
    name: displayName,

    position,
    orientation: computeOrientation(position, headingDegrees),

    model: {
      uri: selectedModel.src,
      scale: currentScale
    },

    label: createHeightLabel(
      selectedModel.heightM,
      currentScale,
      false,
      displayName
    )
  });

  placementMetadata.set(entity, {
    placementId: crypto.randomUUID(),
    modelId: selectedModel.id,
    modelType: selectedModel.isLocal
      ? "local"
      : "configured",

    modelLabel: selectedModel.label,
    objectNumber,
    displayName,
    baseHeightM: selectedModel.heightM,
    headingDegrees
  });

  placedEntities.push(entity);
}

  
  function stopPlacement() {
    isPlacing = false;
    removePreview();
  
    toggleBtn.textContent = "Starta placering";
    toggleBtn.style.backgroundColor = "";
  }
  
  function beginMove() {
    if (!selectedEntity?.model) return;

    const currentPosition = selectedEntity.position?.getValue(
      JulianDate.now()
    );

    if (!defined(currentPosition)) return;

    editMode = "move";
    movingEntity = selectedEntity;
    moveStartPosition = Cartesian3.clone(currentPosition);

    // Keep the moved model out of the depth buffer so it cannot pick itself.
    moveStartColor = movingEntity.model.color;
    movingEntity.model.color = Color.WHITE.withAlpha(GHOST_ALPHA);

    moveBtn.textContent = "Klicka i kartan för att bekräfta";
    moveBtn.style.backgroundColor = "rgb(26,140,0)";
  }

  function finishMove({ cancel = false } = {}) {
    if (movingEntity) {
      if (cancel && moveStartPosition) {
        setEntityPose(
          movingEntity,
          Cartesian3.clone(moveStartPosition),
          getEntityHeading(movingEntity)
        );
      }

      if (movingEntity.model) {
        movingEntity.model.color = moveStartColor;
      }
    }

    editMode = null;
    movingEntity = null;
    moveStartPosition = null;
    moveStartColor = undefined;

    moveBtn.textContent = "Flytta valt";
    moveBtn.style.backgroundColor = "";
  }

  /**
   * Handles a pointer move. Picks are coalesced to one per animation frame
   * because each pick reads back the depth buffer.
   */
  function schedulePointerUpdate(windowPosition) {
    pendingPointerPosition = Cartesian2.clone(
      windowPosition,
      pendingPointerPosition ?? new Cartesian2()
    );

    if (pointerFrameId === 0) {
      pointerFrameId = requestAnimationFrame(processPointerUpdate);
    }
  }

  function processPointerUpdate() {
    pointerFrameId = 0;

    if (!pendingPointerPosition || !isPanelOpen()) return;

    const position = getGroundPosition(pendingPointerPosition);

    if (editMode === "move" && movingEntity) {
      if (defined(position)) {
        setEntityPose(
          movingEntity,
          position,
          getEntityHeading(movingEntity)
        );
      }

      return;
    }

    if (isPlacing) {
      updatePreview(position);
    }
  }



  // ------------------------------------------------------------
  // Scale syncing - enable rescaling on already placed models
  // ------------------------------------------------------------
  function applyScale(value) {
  if (!Number.isFinite(value)) return;

  const scale = clamp(value, LIMITS.MIN_SCALE, LIMITS.MAX_SCALE);

  currentScale = scale;

  scaleInput.value = String(scale);
  scaleNumber.value = String(scale);

  // Update both the preview model and its height label.
  if (previewEntity?.model) {
    previewEntity.model.scale = scale;
    updatePreviewHeightLabel();
  }

  // Update both the selected model and its height label.
  if (selectedEntity?.model) {
    selectedEntity.model.scale = scale;
    updateEntityHeightLabel(selectedEntity);
  }
}
 
  scaleInput.addEventListener("input", () => {
    applyScale(parseFloat(scaleInput.value));
  });
  
  scaleNumber.addEventListener("input", () => {
    const value = parseFloat(scaleNumber.value);
  
    if (Number.isNaN(value)) return;
  
    applyScale(value);
  });

  // ------------------------------------------------------------
  // Model dropdown behavior
  // ------------------------------------------------------------
  select.addEventListener("change", () => {
    if (select.value === LOCAL_MODEL_OPTION_VALUE) {
      /*
      * Keep the current preview until the user actually selects a file.
      * If the dialog is cancelled, restore the previous valid model.
      */
      localModelInput.click();
      return;
    }

    lastValidModelId = select.value;
    updatePreviewForSelectedModel();
  }); 

  localModelInput.addEventListener("cancel", restoreLastValidSelection);

  localModelInput.addEventListener("change", async () => {
    const file = localModelInput.files?.[0];

    if (!file) {
      // No file chosen: do not leave the special command row selected.
      restoreLastValidSelection();
      return;
    }

    if (isImportingLocalModel) {
      return;
    }

    isImportingLocalModel = true;
    setLocalImportBusy(true);

    let objectUrl = null;

    try {
      const fileKey = `${file.name}|${file.size}|${file.lastModified}`;
      const existingModelId = localModelKeys.get(fileKey);

      // The same file was already imported in this session.
      if (existingModelId) {
        selectModel(existingModelId);
        return;
      }

      if (getLocalModelCount() >= LIMITS.MAX_LOCAL_MODELS) {
        throw new Error(
          `Du kan läsa in högst ${LIMITS.MAX_LOCAL_MODELS} egna ` +
          "objekt per session."
        );
      }

      await validateLocalModelFile(file);

      objectUrl = URL.createObjectURL(file);

      await preflightLocalModel(objectUrl);

      addLocalModel(file, objectUrl, fileKey);

      // Ownership has now moved to localModelUrls.
      objectUrl = null;
    } catch (error) {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }

      console.error(
        "Kunde inte läsa den lokala modellen:",
        error
      );

      window.alert(
        error instanceof Error
          ? error.message
          : "Modellen kunde inte läsas."
      );

      restoreLastValidSelection();
    } finally {
      isImportingLocalModel = false;
      setLocalImportBusy(false);
      localModelInput.value = "";
    }
  });

  // ------------------------------------------------------------
  // Rotation syncing
  // ------------------------------------------------------------
  rotateInput.addEventListener("input", () => {
    rotateNumber.value = rotateInput.value;
    currentHeading = CesiumMath.toRadians(parseInt(rotateInput.value, 10));
    applyRotation();
  });

  // Apply in-range values while typing; normalize when editing is done.
  rotateNumber.addEventListener("input", () => {
    const v = parseInt(rotateNumber.value, 10);
    if (Number.isNaN(v) || v < 0 || v > 360) return;
    rotateInput.value = String(v);
    currentHeading = CesiumMath.toRadians(v);
    applyRotation();
  });

  rotateNumber.addEventListener("change", () => {
    const v = parseInt(rotateNumber.value, 10);

    if (Number.isNaN(v)) {
      rotateNumber.value = rotateInput.value;
      return;
    }

    const normalized = normalizeDegrees(v);
    rotateInput.value = String(normalized);
    rotateNumber.value = String(normalized);
    currentHeading = CesiumMath.toRadians(normalized);
    applyRotation();
  });

  // ------------------------------------------------------------
  // LEFT_CLICK: place or select model
  // ------------------------------------------------------------
  placementHandler.setInputAction((evt) => {
  if (!isPanelOpen()) return;
 
  const position = getGroundPosition(evt.position);
 
  // Confirm a move with a map click.
  if (editMode === "move" && movingEntity) {
    if (defined(position)) {
      setEntityPose(
        movingEntity,
        position,
        getEntityHeading(movingEntity)
      );
    }
 
    finishMove();
    return;
  }
 
  // Place a model at the clicked location.
  if (isPlacing) {
    if (!defined(position)) return;
 
    removePreview();
    addPlacedModel(position);
    return;
  }
 
  // Select an existing placed model.
  const picked = viewer.scene.pick(evt.position);
 
  if (defined(picked) && picked.id && placedEntities.includes(picked.id)) {
    selectedEntity = picked.id;
 
    selectedLabel.textContent =
      "Valt: " + (selectedEntity.name || selectedEntity.id || "modell");
 
    moveBtn.disabled = false;
    clearSelectedBtn.disabled = false;
    clearSelectedBtn.title = "";

    rotateInput.disabled = false;
    rotateNumber.disabled = false;
 
    const selectedScale = getEntityScale(selectedEntity);
 
    currentScale = selectedScale;
    scaleInput.value = selectedScale;
    scaleNumber.value = selectedScale;
 
    const normalized = normalizeDegrees(getEntityHeading(selectedEntity));

    rotateInput.value = String(normalized);
    rotateNumber.value = String(normalized);
    currentHeading = CesiumMath.toRadians(normalized);
    
    updateEntityHeightLabel(selectedEntity);
    return;
  }
 
  clearSelection();
}, ScreenSpaceEventType.LEFT_CLICK);

  // ------------------------------------------------------------
  // Toggle placement mode
  // ------------------------------------------------------------
  toggleBtn.addEventListener("click", () => {
  if (!isPanelOpen()) return;

  /*
   * If the special local-file row is selected, open the file picker
   * rather than entering placement mode.
   */
  if (select.value === LOCAL_MODEL_OPTION_VALUE) {
    localModelInput.click();
    return;
  }

  if (!getSelectedModel()) {
    return;
  }
 
  if (isPlacing) {
    stopPlacement();
    return
  }

  isPlacing = true;
  clearSelection();

  toggleBtn.textContent = "Avsluta placering"
  toggleBtn.style.backgroundColor = "rgb(26,140,0)";
  });

  // ------------------------------------------------------------
  // Clear all placed models
  // ------------------------------------------------------------
  clearAllBtn.addEventListener(
    "click",
    () => removeAllPlacedEntities()
  );

  // ------------------------------------------------------------
  // Remove last placed model
  // ------------------------------------------------------------
  clearLastBtn.addEventListener("click", () => {
    const last = placedEntities.pop();
    if (last) {
      placementMetadata.delete(last);
      viewer.entities.remove(last);
    }
    clearSelection();
  });

  // ------------------------------------------------------------
  // Save placements
  // ------------------------------------------------------------
    saveBtn.addEventListener(
    "click",
    savePlacements
  );

  // ------------------------------------------------------------
  // Load placements
  // ------------------------------------------------------------
  loadBtn.addEventListener(
    "click",
    loadPlacements
  );

  // ------------------------------------------------------------
  // Delete saved placements
  // ------------------------------------------------------------
  deleteSaveBtn.addEventListener(
    "click",
    deleteSavedPlacements
  );

  // ------------------------------------------------------------
  // Clear selected entity
  // ------------------------------------------------------------
  clearSelectedBtn.addEventListener(
    "click",
    removeSelectedEntity
  );

  // ------------------------------------------------------------
  // Show or hide object labels
  // ------------------------------------------------------------
  toggleLabelsBtn.addEventListener(
    "click",
    toggleLabels
  );

  // ------------------------------------------------------------
  // Move mode
  // ------------------------------------------------------------
  moveBtn.addEventListener("click", beginMove);
 
  // Follow pointer while moving or while placing a preview model.
  placementHandler.setInputAction((mov) => {
    if (!isPanelOpen()) return;

    if (editMode === "move" || isPlacing) {
      schedulePointerUpdate(mov.endPosition);
    }
  }, ScreenSpaceEventType.MOUSE_MOVE);

  // ------------------------------------------------------------
  // Escape handling
  // ------------------------------------------------------------
  function onKeyDown(event) {
    if (event.key !== "Escape" || !isPanelOpen()) return;

    if (editMode === "move") {
      event.preventDefault();
      finishMove({ cancel: true });
      return;
    }

    if (isPlacing) {
      event.preventDefault();
      stopPlacement();
    }
  }
  
  window.addEventListener("keydown", onKeyDown);
 


  // ------------------------------------------------------------
  // Apply rotation to selected model
  // ------------------------------------------------------------
  function applyRotation() {
  if (!selectedEntity) return;

  const position = selectedEntity.position?.getValue(
    JulianDate.now()
  );

  if (!defined(position)) return;

  const headingDegrees = normalizeDegrees(
    CesiumMath.toDegrees(currentHeading)
  );

  selectedEntity.orientation = computeOrientation(
    position,
    headingDegrees
  );

  const metadata = placementMetadata.get(selectedEntity);

  if (metadata) {
    metadata.headingDegrees = headingDegrees;
  }
}


  // ------------------------------------------------------------
  // Clear current selection
  // ------------------------------------------------------------
  function clearSelection() {
    // Ends a move in progress so the model gets its normal color back.
    if (editMode === "move") {
      finishMove();
    }

    selectedEntity = null;
  
    selectedLabel.textContent = "Inget valt objekt";
  
    moveBtn.disabled = true;
    moveBtn.textContent = "Flytta valt";
    moveBtn.style.backgroundColor = "";

    clearSelectedBtn.disabled = true;
    clearSelectedBtn.title = "Välj ett objekt i kartan först";
  
    rotateInput.disabled = true;
    rotateNumber.disabled = true;
  
    rotateInput.value = "0";
    rotateNumber.value = "0";
  }
  // ------------------------------------------------------------
  // STOP: reset tool state when panel closes
  // ------------------------------------------------------------
  function stop() {
    pendingPointerPosition = null;
    finishMove({ cancel: true });
    stopPlacement();
    clearSelection();
  }

 /*
 * Permanently disposes this placement-tool instance.
 *
 * Do not call this merely when hiding the panel. Revoking a blob URL
 * while a placed entity still references it may prevent Cesium from
 * loading or recreating that model.
 */
  function destroy() {
    stop();

    cancelAnimationFrame(pointerFrameId);
    pointerFrameId = 0;
    window.removeEventListener("keydown", onKeyDown);
    mo.disconnect();
    placementHandler.destroy();

    removeAllPlacedEntities();
    placementMetadata.clear();

    for (const objectUrl of localModelUrls) {
      URL.revokeObjectURL(objectUrl);
    }

    localModelUrls.clear();
  }

  // ------------------------------------------------------------
  // Auto-stop when panel is hidden
  // ------------------------------------------------------------
  const mo = new MutationObserver(() => {
    if (getComputedStyle(panel).display === "none") stop();
  });
  mo.observe(panel, { attributes: true, attributeFilter: ["style"] });

  return {
    stop,
    destroy,
    savePlacements,
    loadPlacements,
    deleteSavedPlacements
};
}
