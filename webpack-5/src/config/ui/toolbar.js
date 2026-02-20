// src/config/ui/toolbar.js

import { windowManager } from "./windowManager.js";
import * as ZoomActions from "@tools/zoom-in-out-home";
import navImgSrc from "@imgs/png/mus_instruk.png";
import mobileImgSrc from "@imgs/png/pek_instruk.png";

/**
 * Initializes the main toolbar and loads all tools dynamically.
 *
 * Responsibilities:
 *  - Render toolbar buttons based on config
 *  - Load tools on demand using dynamic imports
 *  - Handle exclusive tools (only one open at a time)
 *  - Handle mobile-specific exclusions
 *  - Attach zoom/home actions
 *  - Attach popup tools
 *  - Attach pedestrian mode
 *  - Attach generic tools (draw-3d, placement, terrain-section, etc.)
 *
 * @param {object} config - Toolbar configuration object
 * @param {Viewer} viewer - Cesium Viewer instance
 */
export default async function initToolbar(config, viewer) {
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);

  // Tools that should NOT appear on mobile devices
  const mobileExcludedTools = [
    "hide-buildings",
    "draw-3d",
    "measure",
    "placement",
    "terrain-section"
  ];

  const toolbarEl = document.getElementById("toolbar");
  if (!toolbarEl) return;

  // Tools that cannot be open simultaneously
  const exclusiveTools  = ["draw-3d", "measure", "placement", "terrain-section"];
  const exclusivePanels = {};
  const exclusiveApis   = {};

  // Loop through all tools defined in config
  for (const tool of config.toolbar) {
    if (!tool.active) continue;

    // Skip certain tools on mobile
    if (isMobile && mobileExcludedTools.includes(tool.toolName)) {
      console.warn(`Skipping tool on mobile: ${tool.toolName}`);
      continue;
    }

    // Create toolbar button
    const btn = document.createElement("button");
    btn.className = "tool-button";
    btn.title     = tool.toolTip;

    if (tool.iconVar) {
      btn.style.setProperty("--icon", `var(${tool.iconVar})`);
    }

    toolbarEl.appendChild(btn);

    // ------------------------------------------------------------
    // Built‑in zoom tools
    // ------------------------------------------------------------
    if (tool.actionType === "zoomIn") {
      btn.addEventListener("click", () => ZoomActions.zoomIn(viewer));
      continue;
    }
    if (tool.actionType === "zoomOut") {
      btn.addEventListener("click", () => ZoomActions.zoomOut(viewer));
      continue;
    }
    if (tool.actionType === "goHome") {
      btn.addEventListener("click", () => ZoomActions.goHome(viewer));
      continue;
    }

    // ------------------------------------------------------------
    // Rotate North tool
    // ------------------------------------------------------------
    if (tool.actionType === "rotateNorth") {
      const { default: initFindNorth } = await import(
        /* webpackChunkName: "find-north" */
        "@tools/find-north/index.js"
      );
      initFindNorth(btn, viewer);
      continue;
    }

    // ------------------------------------------------------------
    // MEASURE TOOL (exclusive)
    // ------------------------------------------------------------
    if (tool.actionType === "measure") {
      const panel = document.createElement("div");
      panel.className     = "tool-panel";
      panel.id            = `panel-${tool.toolName}`;
      panel.style.display = "none";
      document.body.appendChild(panel);

      const { default: initMeasure } = await import(
        /* webpackChunkName: "measure" */
        "@tools/measure/index.js"
      );

      // initMeasure may be async — await safely
      const api = await initMeasure(panel, viewer);

      const header = panel.querySelector(".panel-header");
      if (header) windowManager.makeDraggable(panel, header);

      // Register as exclusive tool
      if (exclusiveTools.includes(tool.toolName)) {
        exclusivePanels[tool.toolName] = panel;
        exclusiveApis[tool.toolName]   = api;
      }

      // Button click toggles panel
      btn.addEventListener("click", async () => {
        const open = panel.style.display === "block";

        if (!open) {
          // Close other exclusive tools
          await closeOtherExclusive(tool.toolName, exclusiveTools, exclusivePanels, exclusiveApis);

          panel.style.display = "block";
          windowManager.bringToFront(panel);
        } else {
          await safeStop(api);
          panel.style.display = "none";
        }
      });

      continue;
    }

    // ------------------------------------------------------------
    // POPUP TOOL (instructions)
    // ------------------------------------------------------------
    if (tool.actionType === "popup") {
      btn.addEventListener("click", () =>
        showPopup(tool, navImgSrc, mobileImgSrc)
      );
      continue;
    }

    // ------------------------------------------------------------
    // PEDESTRIAN MODE (non-exclusive)
    // ------------------------------------------------------------
    if (tool.toolName === "pedestrian-mode") {
      const panel = document.createElement("div");
      panel.className     = "tool-panel";
      panel.id            = `panel-${tool.toolName}`;
      panel.style.display = "none";
      document.body.appendChild(panel);

      const { default: initPedestrianMode } = await import(
        /* webpackChunkName: "pedestrian-mode" */
        "@tools/pedestrian-mode/index.js"
      );

      const pedestrian = initPedestrianMode(panel, viewer);

      const header = panel.querySelector(".panel-header");
      if (header) windowManager.makeDraggable(panel, header);

      btn.addEventListener("click", () => {
        const isOpen = panel.style.display === "block";

        if (!isOpen) {
          panel.style.display = "block";
          windowManager.bringToFront(panel);
          pedestrian.enter();
        } else {
          pedestrian.exit();
          panel.style.display = "none";
        }
      });

      continue;
    }

    // ------------------------------------------------------------
    // GENERIC TOOLS (draw-3d, placement, terrain-section, hide-buildings, etc.)
    // ------------------------------------------------------------
    {
      const panel = document.createElement("div");
      panel.className     = "tool-panel";
      panel.id            = `panel-${tool.toolName}`;
      panel.style.display = "none";
      document.body.appendChild(panel);

      // Dynamic import based on tool name
      const { default: initTool } = await import(
        /* webpackChunkName: "[request]" */
        `@tools/${tool.toolName}/index.js`
      );

      // Some tools require proj4Defs (terrain-section)
      const api = initTool(panel, viewer, config.proj4Defs);

      // Register exclusive tools
      if (exclusiveTools.includes(tool.toolName)) {
        exclusivePanels[tool.toolName] = panel;
        exclusiveApis[tool.toolName]   = api;
      }

      const header = panel.querySelector(".panel-header");
      if (header) windowManager.makeDraggable(panel, header);

      btn.addEventListener("click", async () => {
        const open = panel.style.display === "block";

        if (!open) {
          if (exclusiveTools.includes(tool.toolName)) {
            await closeOtherExclusive(tool.toolName, exclusiveTools, exclusivePanels, exclusiveApis);
          }
          panel.style.display = "block";
          windowManager.bringToFront(panel);
        } else {
          await safeStop(api);
          panel.style.display = "none";
        }
      });
    }
  }
}

/**
 * Safely stops a tool API.
 * Supports both synchronous and async init functions.
 */
async function safeStop(api) {
  if (!api) return;

  // If API is a Promise (async init)
  if (typeof api.then === "function") {
    try {
      const resolved = await api;
      resolved?.stop?.();
    } catch (e) {
      console.warn("Error stopping tool API:", e);
    }
  } else {
    api?.stop?.();
  }
}

/**
 * Closes all other exclusive tools before opening a new one.
 */
async function closeOtherExclusive(currentName, exclusiveTools, exclusivePanels, exclusiveApis) {
  for (const name of exclusiveTools) {
    if (name === currentName) continue;

    const otherPanel = exclusivePanels[name];
    const otherApi   = exclusiveApis[name];

    if (otherPanel?.style.display === "block") {
      otherPanel.style.display = "none";
      await safeStop(otherApi);
    }
  }
}

/**
 * Displays a popup window with instructions and an image.
 * Supports mobile/desktop image variants.
 */
function showPopup(tool, desktopSrc, mobileSrc) {
  let overlay = document.getElementById("info-overlay");

  // Create overlay if not already created
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "info-overlay";
    overlay.className = "info-overlay hidden";
    document.body.appendChild(overlay);

    const popup = document.createElement("div");
    popup.id = `popup-${tool.toolName}`;
    popup.className = "info-popup";
    overlay.appendChild(popup);

    const header = document.createElement("div");
    header.className = "info-popup-header";
    header.textContent = tool.toolTip;
    popup.appendChild(header);

    const content = document.createElement("div");
    content.className = "info-popup-content";
    content.textContent = tool.popupText || "";
    popup.appendChild(content);

    // Choose image based on screen size
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    const imgSrc   = isMobile ? mobileSrc : desktopSrc;

    const navImg = document.createElement("img");
    navImg.src       = imgSrc;
    navImg.className = "popup-navigation-img";
    navImg.title     = "Klicka för att få en större bild";
    navImg.alt       = tool.toolTip;

    // Toggle fullscreen on click
    navImg.addEventListener("click", () =>
      navImg.classList.toggle("fullscreen")
    );

    popup.appendChild(navImg);

    const closeBtn = document.createElement("button");
    closeBtn.className = "info-popup-close";
    closeBtn.textContent = "Stäng";
    closeBtn.addEventListener("click", () =>
      overlay.classList.add("hidden")
    );
    popup.appendChild(closeBtn);
  }

  // Show popup
  overlay.classList.remove("hidden");
}
