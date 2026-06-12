// src/config/ui/menuFunctions/Resolution/Resolution.js
import "./resolution.css";
// Resolution defined for shadows, terrain and pixels, etc.
// Note: Resolution for specific 3D-tileset layer are set in per layer in index.json, via maximumScreenSpaceError.
const profiles = {
  low: {
    resolutionScale: 0.75,
    shadowMap: {
      size: 1024
    //Soft shadows are not optimal right now, causing small dots on objects. Keept for the future. 
    //softShadows: false
    },
    globe: {
      maximumScreenSpaceError: 4,
      loadingDescendantLimit: 5,
      preloadAncestors: false,
      preloadSiblings: false,
      tileCacheSize: 100
    },
    fog: {
      enabled: true,
      renderable: true,
      density: 0.0012,
      screenSpaceErrorFactor: 4.0,
      heightScalar: 0.001,
      heightFalloff: 0.59,
      maxHeight: 800000.0
    }
  },

  medium: {
    resolutionScale: 1.0,
    shadowMap: {
      size: 2024  
    //Soft shadows are not optimal right now, causing small dots on objects. Keept for the future.
    //softShadows: false
    },
    globe: {
      maximumScreenSpaceError: 2,
      loadingDescendantLimit: 20,
      preloadAncestors: true,
      preloadSiblings: false,
      tileCacheSize: 100
    },
    fog: {
      enabled: true,
      renderable: true,
      density: 0.0006,
      screenSpaceErrorFactor: 2.0,
      heightScalar: 0.001,
      heightFalloff: 0.59,
      maxHeight: 800000.0
    }
  },

  high: {
    resolutionScale: 1.25,
    shadowMap: {
      size: 4096
    //Soft shadows are not optimal right now, causing small dots on objects. Keept for the future.
    //softShadows: false
    },
    globe: {
      maximumScreenSpaceError: 1,
      loadingDescendantLimit: 50,
      preloadAncestors: true,
      preloadSiblings: true,
      tileCacheSize: 300
    },
    fog: {
      enabled: true,
      renderable: true,
      density: 0.0004,
      screenSpaceErrorFactor: 1.0,
      heightScalar: 0.001,
      heightFalloff: 0.59,
      maxHeight: 800000.0
    }
  }
};

/**
 * Applies a terrain resolution profile to the Cesium viewer.
 *
 * @param {import("cesium").Viewer} viewer
 * @param {"low"|"medium"|"high"} level
 */
function applyProfile(viewer, level) {
  const profile = profiles[level];
  if (!profile) return;

  const { resolutionScale, shadowMap, globe, fog } = profile;
  const g = viewer.scene.globe;
  const f = viewer.scene.fog;
  const sm = viewer.scene.shadowMap;

  viewer.resolutionScale   = resolutionScale;

  sm.size                  = shadowMap.size;
//Soft shadows are not optimal right now, causing small dots on objects. Keept for the future.
//sm.softShadows           = shadowMap.softShadows;

  g.maximumScreenSpaceError  = globe.maximumScreenSpaceError;
  g.loadingDescendantLimit   = globe.loadingDescendantLimit;
  g.preloadAncestors         = globe.preloadAncestors;
  g.preloadSiblings          = globe.preloadSiblings;
  g.tileCacheSize            = globe.tileCacheSize;

  f.enabled                  = fog.enabled;
  f.renderable               = fog.renderable;
  f.density                  = fog.density;
  f.screenSpaceErrorFactor   = fog.screenSpaceErrorFactor;
  f.heightScalar             = fog.heightScalar;
  f.heightFalloff            = fog.heightFalloff;
  f.maxHeight                = fog.maxHeight;
}

/**
 * Initializes resolution control.
 * Applies the "medium" profile immediately and returns a setter
 * that should be called when the user changes the dropdown.
 *
 * @param {import("cesium").Viewer} viewer
 * @returns {(level: "low"|"medium"|"high") => void}
 */
export function initResolution(viewer) {
  applyProfile(viewer, "medium");

  return function setResolution(level) {
    applyProfile(viewer, level);
  };
}
