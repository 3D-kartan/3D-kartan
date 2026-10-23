// tools/placement/validation.js
//
// Pure validation helpers for the placement tool. This module has no Cesium
// or DOM dependencies so it can be tested in isolation.

export const LIMITS = Object.freeze({
  MAX_GLB_BYTES: 100 * 1024 * 1024,
  MAX_GLTF_BYTES: 25 * 1024 * 1024,
  MAX_LOCAL_MODELS: 10,
  MAX_SAVED_PLACEMENTS: 500,
  MAX_SAVE_JSON_CHARS: 1024 * 1024,
  MIN_HEIGHT_M: -500,
  MAX_HEIGHT_M: 10000,
  MAX_NAME_LENGTH: 100,
  MAX_OBJECT_NUMBER: 100000,
  MIN_SCALE: 0.1,
  MAX_SCALE: 5
});

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_JSON_CHUNK = 0x4e4f534a; // "JSON"
const GLB_PREFIX_BYTES = 20; // 12-byte header + 8-byte first chunk header

const SAFE_ID_PATTERN = /^[\w-]{1,64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;
// eslint-disable-next-line no-control-regex
const URI_IGNORED_CHARACTERS = /[\u0000-\u0020]/g;

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Resolves a configured model URL and returns its absolute href only when it
 * is an http(s) URL on the given origin. Returns null otherwise.
 */
export function resolveSameOriginUrl(src, baseUrl, origin) {
  try {
    const url = new URL(src, baseUrl);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    return url.origin === origin ? url.href : null;
  } catch {
    return null;
  }
}

function sanitizeText(value, maxLength) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value
    .replace(CONTROL_CHARACTERS, " ")
    .trim()
    .slice(0, maxLength)
    .trim();

  return cleaned === "" ? null : cleaned;
}

/**
 * Rejects glTF JSON that is invalid or that references anything other than
 * embedded data: URIs. External references would make the browser fetch
 * arbitrary URLs when the model loads.
 */
export function assertSelfContainedGltf(gltf) {
  if (
    !gltf ||
    typeof gltf !== "object" ||
    !gltf.asset ||
    typeof gltf.asset !== "object"
  ) {
    throw new Error("Filen verkar inte vara en giltig glTF-modell.");
  }

  if (
    typeof gltf.asset.version !== "string" ||
    !gltf.asset.version.startsWith("2.")
  ) {
    throw new Error("Endast glTF 2.x stöds.");
  }

  const resources = [
    ...(Array.isArray(gltf.buffers) ? gltf.buffers : []),
    ...(Array.isArray(gltf.images) ? gltf.images : [])
  ];

  for (const resource of resources) {
    const uri = resource?.uri;

    if (uri === undefined || uri === null) {
      continue;
    }

    const isEmbedded =
      typeof uri === "string" &&
      uri
        .replace(URI_IGNORED_CHARACTERS, "")
        .toLowerCase()
        .startsWith("data:");

    if (!isEmbedded) {
      throw new Error(
        "Modellen använder externa filer, till exempel BIN-filer " +
        "eller bilder. Exportera modellen som en enda GLB-fil och " +
        "försök igen."
      );
    }
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Modellfilen innehåller inte giltig JSON.");
  }
}

/**
 * Reads only the JSON chunk of a GLB file, after checking the binary header.
 */
export async function readGlbJson(file) {
  const invalid = () =>
    new Error("Filen är inte en giltig GLB-fil.");

  if (file.size < GLB_PREFIX_BYTES) {
    throw invalid();
  }

  const view = new DataView(
    await file.slice(0, GLB_PREFIX_BYTES).arrayBuffer()
  );

  const chunkLength = view.getUint32(12, true);

  if (
    view.getUint32(0, true) !== GLB_MAGIC ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== file.size ||
    view.getUint32(16, true) !== GLB_JSON_CHUNK ||
    chunkLength === 0 ||
    chunkLength > LIMITS.MAX_GLTF_BYTES ||
    GLB_PREFIX_BYTES + chunkLength > file.size
  ) {
    throw invalid();
  }

  const jsonText = await file
    .slice(GLB_PREFIX_BYTES, GLB_PREFIX_BYTES + chunkLength)
    .text();

  return parseJson(jsonText);
}

/**
 * Basic validation of a user-selected model file. Resolves with the
 * lowercase extension (".glb" or ".gltf") and throws a user-facing Error
 * when the file is not acceptable.
 */
export async function validateLocalModelFile(file) {
  if (!file || typeof file.name !== "string" || typeof file.size !== "number") {
    throw new Error("Ingen fil valdes.");
  }

  const lastDot = file.name.lastIndexOf(".");
  const extension =
    lastDot < 0 ? "" : file.name.slice(lastDot).toLowerCase();

  if (extension !== ".glb" && extension !== ".gltf") {
    throw new Error("Filtypen stöds inte. Välj en GLB- eller GLTF-fil.");
  }

  if (file.size === 0) {
    throw new Error("Den valda filen är tom.");
  }

  const maxBytes =
    extension === ".glb" ? LIMITS.MAX_GLB_BYTES : LIMITS.MAX_GLTF_BYTES;

  if (file.size > maxBytes) {
    throw new Error(
      `Filen är för stor. Den maximala tillåtna storleken för ` +
      `${extension}-filer är ${Math.round(maxBytes / (1024 * 1024))} MB.`
    );
  }

  const gltf =
    extension === ".glb"
      ? await readGlbJson(file)
      : parseJson(await file.text());

  assertSelfContainedGltf(gltf);

  return extension;
}

/**
 * Parses the serialized saved state and applies size limits.
 * Throws a user-facing Error when the state cannot be used at all.
 */
export function parseSavedState(serialized) {
  if (
    typeof serialized !== "string" ||
    serialized.length > LIMITS.MAX_SAVE_JSON_CHARS
  ) {
    throw new Error(
      "Den sparade placeringsdatan är för stor eller kunde inte läsas."
    );
  }

  let state;

  try {
    state = JSON.parse(serialized);
  } catch {
    throw new Error("Den sparade placeringsdatan kunde inte läsas.");
  }

  if (
    !state ||
    typeof state !== "object" ||
    state.schemaVersion !== 1 ||
    !Array.isArray(state.placements)
  ) {
    throw new Error(
      "Den sparade placeringsdatan har ett format som inte stöds."
    );
  }

  return {
    placements: state.placements.slice(0, LIMITS.MAX_SAVED_PLACEMENTS),
    truncatedCount: Math.max(
      0,
      state.placements.length - LIMITS.MAX_SAVED_PLACEMENTS
    )
  };
}

/**
 * Validates and sanitizes one saved placement. Returns null when the entry is
 * unusable. `usedPlacementIds` is updated so ids stay unique within a load.
 * The model id is not checked here; the caller resolves it.
 */
export function normalizeSavedPlacement(raw, usedPlacementIds) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const { longitude, latitude, height } = raw.position ?? {};

  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(height) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }

  const scale = Number.isFinite(raw.scale)
    ? clamp(raw.scale, LIMITS.MIN_SCALE, LIMITS.MAX_SCALE)
    : 1;

  const headingDegrees = Number.isFinite(raw.headingDegrees)
    ? normalizeDegrees(raw.headingDegrees)
    : 0;

  const objectNumber =
    Number.isInteger(raw.objectNumber) &&
    raw.objectNumber >= 1 &&
    raw.objectNumber <= LIMITS.MAX_OBJECT_NUMBER
      ? raw.objectNumber
      : null;

  const placementId =
    typeof raw.placementId === "string" &&
    SAFE_ID_PATTERN.test(raw.placementId) &&
    !usedPlacementIds.has(raw.placementId)
      ? raw.placementId
      : crypto.randomUUID();

  usedPlacementIds.add(placementId);

  return {
    longitude,
    latitude,
    height: clamp(height, LIMITS.MIN_HEIGHT_M, LIMITS.MAX_HEIGHT_M),
    scale,
    headingDegrees,
    objectNumber,
    displayName: sanitizeText(raw.displayName, LIMITS.MAX_NAME_LENGTH),
    placementId
  };
}
