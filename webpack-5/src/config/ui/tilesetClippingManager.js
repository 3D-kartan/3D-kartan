// config/ui/tilesetClippingManager.js
import {
  ClippingPolygon,
  ClippingPolygonCollection,
  Cartesian3
} from "cesium";

import {
  flattenLonLatPairs,
  getInlineClippingPositions,
  getClippingMaxPoints,
  resolveClippingPositionsFromProject
} from "./clippingSpecResolver.js";

export function createTilesetClippingManager(viewer) {
  const tilesets = new Set();

  let polygonPositions = null; // Cartesian3[]
  let inverse = false;
  let enabled = false;

  // Optional: avoid unnecessary rebuild if the same polygon/inverse is sent again
  let polygonKey = "";

  // Race protection for async loading
  let requestId = 0;

  function computeKey(degreesArray, inv) {
    // degreesArray: [lon,lat,lon,lat,...]
    return `${inv ? 1 : 0}|${degreesArray.join(",")}`;
  }

  function clearAllApplied() {
    polygonPositions = null;
    inverse = false;
    polygonKey = "";

    tilesets.forEach((ts) => {
      if (ts) ts.clippingPolygons = undefined;
    });
  }

  function buildCollection() {
    if (!polygonPositions || polygonPositions.length < 3) return null;

    // Important: new instance per tileset
    return new ClippingPolygonCollection({
      enabled,
      inverse,
      polygons: [new ClippingPolygon({ positions: polygonPositions })]
    });
  }

  function applyToTileset(ts) {
    if (!ts) return;

    if (!polygonPositions) {
      ts.clippingPolygons = undefined;
      return;
    }

    ts.clippingPolygons = buildCollection();
  }

  function requestRender() {
    // safe-guard (sometimes the viewer might be in teardown)
    try {
      viewer?.scene?.requestRender?.();
    } catch (_) {}
  }

  function setPolygonFromLonLatPairs(positionsPairs, options = {}) {
    const degrees = flattenLonLatPairs(positionsPairs);
    if (degrees.length < 6) {
      clearAllApplied();
      requestRender();
      return false;
    }

    const nextInverse = !!options.inverse;
    const nextKey = computeKey(degrees, nextInverse);

    // If nothing has changed: update only enabled/inverse on existing collections
    if (nextKey === polygonKey && polygonPositions) {
      inverse = nextInverse;
      tilesets.forEach((ts) => {
        if (ts?.clippingPolygons) {
          ts.clippingPolygons.inverse = inverse;
          ts.clippingPolygons.enabled = enabled;
        }
      });
      requestRender();
      return true;
    }

    polygonPositions = Cartesian3.fromDegreesArray(degrees);
    inverse = nextInverse;
    polygonKey = nextKey;

    tilesets.forEach((ts) => applyToTileset(ts));
    requestRender();
    return true;
  }

  return {
    registerTileset(ts) {
      if (!ts) return;
      tilesets.add(ts);
      applyToTileset(ts);
      requestRender();
    },

    unregisterTileset(ts) {
      if (!ts) return;
      tilesets.delete(ts);
      ts.clippingPolygons = undefined;
      requestRender();
    },

    /**
     * Sync-variant (backward compatible): works only if positions are inline.
     * @returns {boolean}
     */
    setPolygonFromProject(project, options = {}) {
  const pairs = getInlineClippingPositions(project, "tileset");

  if (!pairs || pairs.length < 3) {
    clearAllApplied();
    requestRender();
    return false;
  }

  return setPolygonFromLonLatPairs(pairs, options);
},

    /**
     * Async-variant: supports both inline positions and GeoJSON URL.
     * @returns {Promise<boolean>}
     */
    async setPolygonFromProjectAsync(project, options = {}) {
  const myReq = ++requestId;

  let pairs = null;
  try {
    pairs = await resolveClippingPositionsFromProject(project, "tileset");
  } catch (e) {
    console.warn("[tilesetClipMgr] kunde inte läsa clipping:", e);
    pairs = null;
  }

  // if a newer request started while we were waiting: ignore
  if (myReq !== requestId) return false;

  if (!pairs || pairs.length < 3) {
    clearAllApplied();
    requestRender();
    return false;
  }

  const maxPoints = getClippingMaxPoints(project, "tileset", 5000);
  if (pairs.length > maxPoints) {
    console.warn(
      `[tilesetClipMgr] För många punkter i klippmask (${pairs.length} > ${maxPoints})`
    );
    clearAllApplied();
    requestRender();
    return false;
  }

  return setPolygonFromLonLatPairs(pairs, options);
},

    clearPolygon() {
      requestId++; // invalidate any ongoing fetch
      clearAllApplied();
      requestRender();
    },

    setEnabled(v) {
      enabled = !!v;

      tilesets.forEach((ts) => {
        if (ts?.clippingPolygons) ts.clippingPolygons.enabled = enabled;
      });

      requestRender();
    },

    getEnabled() {
      return enabled;
    },

    hasPolygon() {
      return !!polygonPositions && polygonPositions.length >= 3;
    },

    getInverse() {
      return inverse;
    }
  };
}