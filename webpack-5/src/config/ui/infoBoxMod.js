// src/ui/infoBoxMod.js
import { windowManager } from "./windowManager.js";

/**
 * Enhances Cesium's InfoBox with:
 *  - Draggable window behavior (via windowManager)
 *  - Robust initial placement + clamping to the viewer container
 *  - A minimize button placed on the InfoBox panel (NOT inside the title DOM)
 *  - Automatic reset of minimized state when the InfoBox is closed/hidden
 *  - Re-ensures the minimize button if Cesium re-renders DOM
 *  - Optional styling injected into the InfoBox iframe document
 *
 * Why append to `.cesium-infoBox` instead of `.cesium-infoBox-title`?
 *  - Cesium may rebuild the title/header DOM, which can break custom buttons.
 *  - The title/header is also used as the drag handle; placing the button there
 *    can make taps compete with dragging on mobile.
 *  - The panel itself is more stable; we position the button absolutely and
 *    keep it above the title area via z-index.
 */
export default function makeCesiumInfoBoxDraggable(viewer) {
  const root = viewer?.container;
  if (!root) return;

  const panel = root.querySelector(".cesium-infoBox");
  if (!panel) return;

  /**
   * Returns the best available drag handle element.
   * (Cesium may have `.cesium-infoBox-title` or `.cesium-infoBox-header`
   * depending on version / theme.)
   */
  const getHandle = () =>
    panel.querySelector(".cesium-infoBox-title") ||
    panel.querySelector(".cesium-infoBox-header") ||
    panel;

  const handle = getHandle();

  // Ensure absolute positioning for dragging.
  panel.style.position = "absolute";
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.transform = "none"; // avoid transform-based positioning when dragging

  // Put it near the top on first run (if not already placed).
  if (!panel.style.top) panel.style.top = "10%";

  /**
   * Toggle minimized UI state.
   * CSS should hide `.cesium-infoBox-body` and/or `.cesium-infoBox-iframe`
   * when `is-minimized` is present.
   */
  const setMinimized = (min) => {
    panel.classList.toggle("is-minimized", !!min);
  };

  /**
   * Creates the minimize button if missing.
   * Appends it to the InfoBox panel so it survives title/header re-renders.
   */
  const ensureMinimizeButton = () => {
    // If already present anywhere on the panel, do nothing.
    if (panel.querySelector(".infobox-minimize-btn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "infobox-minimize-btn";
    btn.setAttribute("aria-label", "Minimize information box");
    btn.title = "Minimize";

    /**
     * IMPORTANT FOR MOBILE:
     * Avoid preventDefault() on pointer/touch down, because it can interfere with taps
     * on iOS. We only stop propagation to prevent drag initiation and scene picks.
     */
    const stopPropagation = (e) => {
      e.stopPropagation();
    };

    // Stop drag start on the handle (and prevent Cesium pick-through).
    btn.addEventListener("pointerdown", stopPropagation);
    btn.addEventListener("pointerup", (e) => {
      e.stopPropagation();

      setMinimized(!panel.classList.contains("is-minimized"));

      // When height changes, keep it inside the container.
      requestAnimationFrame(clampToContainer);

      // Avoid "sticky" focus styles on mobile browsers.
      btn.blur?.();
    });

    panel.appendChild(btn);
  };

  /**
   * Centers the InfoBox horizontally within the viewer container.
   * Used only until user drags (panel.dataset.userPositioned is set).
   */
  const centerHorizontally = () => {
    const rootRect = root.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const left = Math.max(0, (rootRect.width - rect.width) / 2);
    panel.style.left = `${left}px`;
  };

  /**
   * Clamps the InfoBox so it stays fully visible inside the viewer container.
   */
  const clampToContainer = () => {
    const rootRect = root.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();

    const leftNow = rect.left - rootRect.left;
    const topNow = rect.top - rootRect.top;

    const maxLeft = rootRect.width - rect.width;
    const maxTop = rootRect.height - rect.height;

    const left = Math.min(Math.max(leftNow, 0), Math.max(maxLeft, 0));
    const top = Math.min(Math.max(topNow, 0), Math.max(maxTop, 0));

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };

  /**
   * Initial auto-placement that only runs until the user drags the window.
   */
  const ensureInitialPlacement = () => {
    if (!panel.dataset.userPositioned) {
      centerHorizontally();
      clampToContainer();
    }
  };

  /**
   * Keep the InfoBox inside the viewer when viewport/container changes size.
   */
  const onViewportResize = () => {
    if (!panel.dataset.userPositioned) {
      ensureInitialPlacement();
    } else {
      clampToContainer();
    }
  };

  // Create button immediately (first open).
  ensureMinimizeButton();

  // --- Reset minimize state when closing/hiding to avoid "stuck minimized" next time ---

  // 1) Reset when the user clicks the close button.
  //    Use capture so we run before Cesium's internal handlers.
  const closeBtn = panel.querySelector(".cesium-infoBox-close");
  if (closeBtn) {
    closeBtn.addEventListener(
      "click",
      () => {
        setMinimized(false);
      },
      true
    );
  }

  // 2) Reset when Cesium hides the InfoBox by changing style/class/aria-hidden.
  const visibilityMO = new MutationObserver(() => {
    const hidden =
      panel.style.display === "none" ||
      panel.getAttribute("aria-hidden") === "true" ||
      (panel.classList.contains("cesium-infoBox-visible") === false &&
        panel.className.includes("cesium-infoBox-visible"));

    if (hidden) setMinimized(false);
  });

  visibilityMO.observe(panel, {
    attributes: true,
    attributeFilter: ["style", "class", "aria-hidden"],
  });

  // 3) When selected entity changes: reset minimize and re-ensure the button.
  if (viewer?.selectedEntityChanged) {
    viewer.selectedEntityChanged.addEventListener(() => {
      setMinimized(false);
      requestAnimationFrame(() => {
        ensureMinimizeButton();
        ensureInitialPlacement();
      });
    });
  }

  // --- Resize/viewport observers ---

  const rootRO = new ResizeObserver(onViewportResize);
  rootRO.observe(root);

  window.addEventListener("resize", onViewportResize, { passive: true });
  document.addEventListener("fullscreenchange", onViewportResize);

  // Mark as user-positioned after a drag start and bring to front.
  handle.addEventListener("pointerdown", () => {
    panel.dataset.userPositioned = "1";
    windowManager.bringToFront(panel);
  });

  requestAnimationFrame(() => {
    ensureInitialPlacement();
    requestAnimationFrame(ensureInitialPlacement);
  });

  const panelRO = new ResizeObserver(() => {
    ensureMinimizeButton();
    ensureInitialPlacement();
  });
  panelRO.observe(panel);

  const frame = viewer.infoBox?.frame;
  if (frame) {
    frame.addEventListener("load", () => {
      ensureMinimizeButton();
      ensureInitialPlacement();
    });
  }

  windowManager.makeDraggable(panel, handle);

  /**
   * Inject CSS into the InfoBox iframe document (the description lives there).
   */
  function styleInfoBoxDescription(v) {
    const iframe = v.infoBox?.frame;
    if (!iframe) return;

    const apply = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;

      if (doc.getElementById("custom-infobox-style")) return;

      const style = doc.createElement("style");
      style.id = "custom-infobox-style";
      style.textContent = `
        table {
          width: 100%;
          table-layout: fixed; /* enforce column widths so long text can't stretch the table */
          border-collapse: collapse;
          font-size: 13px;
        }

        .cesium-infoBox-description {
          margin-right: 0;
          touch-action: none;
          -webkit-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
        }

        @media (max-width: 640px) {
          .cesium-infoBox-iframe,
          .cesium-infoBox-description {
            touch-action: pan-y !important;
          }

          .cesium-infoBox-body,
          .cesium-infoBox-description {
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
          }
        }

        th, td {
          padding: 6px !important;
          border-bottom: 1px solid #ccc;
          vertical-align: top;
          background: rgba(255, 255, 255, 1) !important;
          color: #000000;
          overflow-wrap: break-word;
          word-break: break-word;
          overflow: hidden;
        }
        tr td:first-child {
        width: 40%;
      }
        th {
          text-align: left !important;
          font-weight: bold !important;
          width: 40% !important;
        }

        tr:last-child th, tr:last-child td {
          border-bottom: none;
        }
      `;
      doc.head.appendChild(style);
    };

    apply();
    iframe.addEventListener("load", apply);
  }

  styleInfoBoxDescription(viewer);
}