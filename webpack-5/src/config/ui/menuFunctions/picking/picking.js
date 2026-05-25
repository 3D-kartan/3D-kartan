// src/ui/menuFunctions/picking/picking.js
import {
  Color,
  defined,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from "cesium";

export function initPicking(viewer, opts = {}) {
  const highlightColor = opts.color ?? Color.LIME.withAlpha(0.9);

  let selectedFeature;
  let originalColor;

  const clear = () => {
    if (defined(selectedFeature) && defined(originalColor) && defined(selectedFeature.color)) {
      selectedFeature.color = originalColor;
    }
    selectedFeature = undefined;
    originalColor = undefined;
  };

  // Clear highlight when InfoBox is closed 
  const onSelectedEntityChanged = (entity) => {
    if (!defined(entity)) clear();
  };
  viewer.selectedEntityChanged.addEventListener(onSelectedEntityChanged);

  // Own handler so we don't overwrite Cesium default click/InfoBox behavior
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);

    if (!defined(picked)) {
      clear();
      return;
    }

    const isTilesFeature = defined(picked.getProperty) && defined(picked.color);
    if (!isTilesFeature) return;

    if (picked === selectedFeature) return;

    clear();
    selectedFeature = picked;
    originalColor = Color.clone(picked.color);
    picked.color = highlightColor;
  }, ScreenSpaceEventType.LEFT_CLICK);

  // teardown
  return function teardownPicking() {
    clear();
    handler.destroy();
    viewer.selectedEntityChanged.removeEventListener(onSelectedEntityChanged);
  };
}