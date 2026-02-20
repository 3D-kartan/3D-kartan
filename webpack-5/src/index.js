import {
  Viewer,
  Rectangle,
  Camera,
  CesiumTerrainProvider,
  IonResource,
  Ion,
  Terrain,
  createWorldTerrainAsync,
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  viewerCesium3DTilesInspectorMixin
} from "cesium";

import initLayerMenu from "./config/ui/layerMenu";
import initToolbar from "./config/ui/toolbar";
import { windowManager } from "./config/ui/windowManager";
import initMenuUI from "./config/ui/menu.js";
import { initSearchBar } from "./config/ui/searchbar.js";
import { applyUrlCamera } from "./config/ui/menuFunctions/shareMap/shareMap.js";
import initProjectMenuUI from "./config/ui/projectMenu.js";
import { initCopyCoordinates } from "./config/ui/rightClickMenu.js";

// CSS imports
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./css/main.css";
import "./css/toolbar.css";
import "./css/layerMenu.css";
import "./config/images/material-icons-svg/material-icons-svg.css";
import "./tools/placement/placement.css";
import "./css/menu.css";
import "./css/projectMenu.css";
import "./css/searchbar.css";
import "./css/rightClickMenu.css";

async function main() {

  // ------------------------------------------------------------
  // 1) Load configuration BEFORE creating the viewer
  // ------------------------------------------------------------
  const res    = await fetch("./index.json");
  const config = await res.json();

  // ------------------------------------------------------------
  // 2) Build a lookup map for style icons
  //    Example: stylesMap["ortofoto"] → "ortofoto.png"
  // ------------------------------------------------------------
  config.stylesMap = {};
  config.styles.forEach(s => config.stylesMap[s.name] = s.img);

  // ------------------------------------------------------------
  // 3) Set global default camera extent BEFORE creating the viewer
  //    Cesium reads these static values only during viewer construction.
  // ------------------------------------------------------------
  const [camExtentCfg, camZoomCfg] = config.camera;
  const [west, south, east, north] = camExtentCfg.startExtent;

  Camera.DEFAULT_VIEW_RECTANGLE = Rectangle.fromDegrees(west, south, east, north);
  Camera.DEFAULT_VIEW_FACTOR    = 0;

  // ------------------------------------------------------------
  // 4) Set Ion token if configured
  // ------------------------------------------------------------
  if (config.ionId && config.ionId.length > 0 && config.ionId[0].useIonId) {
    Ion.defaultAccessToken = config.ionId[0].id;
  }

  // ------------------------------------------------------------
  // 5) Create the Cesium Viewer WITHOUT terrain
  //    (We attach terrain later using the new Terrain API)
  // ------------------------------------------------------------
  const viewer = new Viewer("cesiumContainer", {
    terrainProvider: false,  // Important: disable legacy terrain
    timeline: false,
    animation: false,
    projectionPicker: false,
    sceneModePicker: false,
    vrButton: false,
    fullscreenButton: false,
    homeButton: false,
    selectionIndicator: false,
    infoBox: true,
    shadows: false,
    shouldAnimate: false,
    geocoder: false,
    navigationHelpButton: false,
    baseLayerPicker: false,
    imageryProvider: false,  // No default imagery
  });

  // Enable depth testing so objects behind terrain are hidden
  viewer.scene.globe.depthTestAgainstTerrain = true;

  // Disable double-click zoom
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
    ScreenSpaceEventType.LEFT_DOUBLE_CLICK
  );

  // Debug tool (optional)
  // viewer.extend(viewerCesium3DTilesInspectorMixin);

  // ------------------------------------------------------------
  // 6) Build the correct terrain provider based on config
  // ------------------------------------------------------------
  let terrainProvider;

  if (config.terrain && config.terrain.length > 0) {
    const terrainCfg = config.terrain[0];

    switch (terrainCfg.terrainType) {
      case "ion":
        terrainProvider = await CesiumTerrainProvider.fromIonAssetId(
          terrainCfg.assetId
        );
        break;

      case "url":
        terrainProvider = await CesiumTerrainProvider.fromUrl(terrainCfg.url);
        break;

      case "world":
      default:
        terrainProvider = await createWorldTerrainAsync();
        break;
    }

  } else {
    // Fallback: Cesium World Terrain
    terrainProvider = await CesiumTerrainProvider.fromWorldTerrain();
  }

  // ------------------------------------------------------------
  // 7) Apply terrain using the NEW Terrain API
  // ------------------------------------------------------------
  viewer.scene.setTerrain(new Terrain(terrainProvider));

  // ------------------------------------------------------------
  // 8) Apply zoom limits from config
  // ------------------------------------------------------------
  viewer.scene.screenSpaceCameraController.minimumZoomDistance =
    camZoomCfg.minimumZoomDistance;

  viewer.scene.screenSpaceCameraController.maximumZoomDistance =
    camZoomCfg.maximumZoomDistance;

  // ------------------------------------------------------------
  // 9) Initialize UI modules
  // ------------------------------------------------------------
  initMenuUI(viewer, config);               // Top-right menu
  initProjectMenuUI(viewer, config);        // Bottom-left project menu
  initSearchBar(viewer, config);            // Address search bar
  initCopyCoordinates(viewer, config.proj4Defs); // Right-click coordinate menu
  initLayerMenu(viewer, config);            // Layer menu (left side)

  // Toolbar (measure, draw, placement, terrain-section, etc.)
  await initToolbar(config, viewer);

  // ------------------------------------------------------------
  // 10) Apply camera parameters from URL (if shared link)
  // ------------------------------------------------------------
  applyUrlCamera(viewer);
}

main();
