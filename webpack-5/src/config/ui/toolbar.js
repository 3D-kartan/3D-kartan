// src/config/ui/toolbar.js
import { TOOL_INSTRUCTIONS, DEFAULT_INSTRUCTION } from "@tools/tool-instructions.js";
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
    "terrain-section",
  ];

  const toolbarItems = Array.isArray(config.toolbar) ? config.toolbar : [];
  if (!Array.isArray(config.toolbar)) {
    console.warn('No valid "toolbar" array found in index.json.');
  }

  const toolbarEl = document.getElementById("toolbar");
  if (!toolbarEl) return;

  // Tools that cannot be open simultaneously
  const exclusiveTools = ["draw-3d", "measure", "placement", "terrain-section"];
  const exclusivePanels = {};
  const exclusiveApis = {};

  // Loop through all tools defined in config
  for (const tool of toolbarItems) {
    if (!tool?.active) continue;

    // Skip certain tools on mobile
    if (isMobile && mobileExcludedTools.includes(tool.toolName)) {
      console.warn(`Skipping tool on mobile: ${tool.toolName}`);
      continue;
    }

    // Create toolbar button
    const btn = document.createElement("button");
    btn.className = "tool-button";
    btn.id = `tool-btn-${tool.toolName}`;
    btn.title = tool.toolTip;

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
      btn.addEventListener("click", async () => {
        await ZoomActions.goHome(viewer);
      });
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
      panel.className = "tool-panel";
      panel.id = `panel-${tool.toolName}`;
      panel.style.display = "none";
      document.body.appendChild(panel);

      const { default: initMeasure } = await import(
        /* webpackChunkName: "measure" */
        "@tools/measure/index.js"
      );

      // initMeasure may be async — await safely
      const api = await initMeasure(panel, viewer);

      // Add close button to the panel header (top-right)
      ensurePanelHeaderButtons(panel, api, {
        toolName: tool.toolName,
        toolTitle: tool.toolTip,
      });

      const header = panel.querySelector(".panel-header");
      if (header) windowManager.makeDraggable(panel, header);

      // Register as exclusive tool
      if (exclusiveTools.includes(tool.toolName)) {
        exclusivePanels[tool.toolName] = panel;
        exclusiveApis[tool.toolName] = api;
      }

      // Button click toggles panel
      btn.addEventListener("click", async () => {
        const open = panel.style.display === "flex";

        if (!open) {
          // Close other exclusive tools
          await closeOtherExclusive(
            tool.toolName,
            exclusiveTools,
            exclusivePanels,
            exclusiveApis
          );

          panel.style.display = "flex";
          windowManager.bringToFront(panel);

          requestAnimationFrame(() => {
          windowManager.keepInViewport(panel);
          });
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
      panel.className = "tool-panel";
      panel.id = `panel-${tool.toolName}`;
      panel.style.display = "none";
      document.body.appendChild(panel);

      const { default: initPedestrianMode } = await import(
        /* webpackChunkName: "pedestrian-mode" */
        "@tools/pedestrian-mode/index.js"
      );

      const pedestrian = initPedestrianMode(panel, viewer);

      // Add close button to the panel header (top-right)
      // Note: this will call pedestrian.stop() if it exists. If you want it to
      // call pedestrian.exit() instead, we can special-case it.
      ensurePanelHeaderButtons(panel, pedestrian, {
        toolName: tool.toolName,
        toolTitle: tool.toolTip,
        onClose: async () => {
          pedestrian.exit?.(); // samma funktionalitet som Avsluta-knappen
        }
      });

      const header = panel.querySelector(".panel-header");
      if (header) windowManager.makeDraggable(panel, header);

      btn.addEventListener("click", () => {
        const isOpen = panel.style.display === "flex";
        // Close project sidebar if open
        config.projectMenuApi?.closeProjectSidebar?.();
        
        if (!isOpen) {
          panel.style.display = "flex";
          windowManager.bringToFront(panel);
          pedestrian.enter();

          requestAnimationFrame(() => {
            windowManager.keepInViewport(panel);
          });
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
      panel.className = "tool-panel";
      panel.id = `panel-${tool.toolName}`;
      panel.style.display = "none";
      document.body.appendChild(panel);

      // Dynamic import based on tool name
      const { default: initTool } = await import(
        /* webpackChunkName: "[request]" */
        `@tools/${tool.toolName}/index.js`
      );

      let api;

      const toolsUsingToolConfig = new Set(["bookmarks", "forms"]);

      api = toolsUsingToolConfig.has(tool.toolName)
        ? initTool(panel, viewer, tool)
        : initTool(panel, viewer, config.proj4Defs);

      // Add close button to the panel header (top-right)
      ensurePanelHeaderButtons(panel, api, {
        toolName: tool.toolName,
        toolTitle: tool.toolTip,
      });

      // Register exclusive tools
      if (exclusiveTools.includes(tool.toolName)) {
        exclusivePanels[tool.toolName] = panel;
        exclusiveApis[tool.toolName] = api;
      }

      const header = panel.querySelector(".panel-header");
      if (header) windowManager.makeDraggable(panel, header);

      btn.addEventListener("click", async () => {
        const open = panel.style.display === "flex";

        if (!open) {
          if (exclusiveTools.includes(tool.toolName)) {
            await closeOtherExclusive(
              tool.toolName,
              exclusiveTools,
              exclusivePanels,
              exclusiveApis
            );
          }
          panel.style.display = "flex";
          windowManager.bringToFront(panel);

          requestAnimationFrame(() => {
            windowManager.keepInViewport(panel);
          });
        } else {
          await safeStop(api);
          panel.style.display = "none";
        }
      });
    }
  }
}

/**
 * Ensures a close button exists in the panel header (top-right).
 * Retries a few animation frames to support tools that render their header
 * asynchronously (common on desktop).
 *
 * Also prevents event propagation on pointer/mouse down so the window manager
 * does not "bring to front" (increase z-index) when clicking the close button.
 *
 * @param {HTMLElement} panel - The tool panel element
 * @param {any} api - Tool API or a Promise resolving to the API
 * @param {Object} options - Additional options
 * @param {Function} options.onClose - Callback to execute when the close button is clicked
 */
function ensurePanelHeaderButtons(panel, api, options = {}) {
  const { onClose, toolName, toolTitle } = options;
  const MAX_TRIES = 10;
  let tries = 0;

  const tryAttach = () => {
    const header = panel.querySelector(".panel-header");
    const body = panel.querySelector(".panel-body");

    if (!header) {
      if (++tries <= MAX_TRIES) requestAnimationFrame(tryAttach);
      return;
    }

    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // ---------- MINIMIZE / RESTORE ----------
    let minBtn = header.querySelector(".panel-minimize");
    if (!minBtn) {
      minBtn = document.createElement("button");
      minBtn.type = "button";
      minBtn.className = "panel-minimize tool-button";
      minBtn.title = "Minimera";

      // default: body visible => show "dropup"
      minBtn.style.setProperty("--icon", "var(--black-icon-arrow-dropup)");

      minBtn.addEventListener("pointerdown", stop);
      minBtn.addEventListener("mousedown", stop);
      minBtn.addEventListener("pointerup", stop);
      minBtn.addEventListener("mouseup", stop);

      minBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const panelBody = body || panel.querySelector(".panel-body");
        if (!panelBody) return;

        const isHidden =
          panelBody.style.display === "none" ||
          getComputedStyle(panelBody).display === "none";

        if (isHidden) {
          // restore
          panelBody.style.display = "";
          panel.classList.remove("is-minimized");
          minBtn.style.setProperty("--icon", "var(--black-icon-arrow-dropup)");
          minBtn.title = "Minimera";
        } else {
          // minimize
          panelBody.style.display = "none";
          panel.classList.add("is-minimized");
          minBtn.style.setProperty("--icon", "var(--black-icon-arrow-dropdown)");
          minBtn.title = "Expandera";
        }
      });

      header.appendChild(minBtn);
    }

    // ---------- HELP ----------
    if (!header.querySelector(".panel-help")) {
      const helpBtn = document.createElement("button");
      helpBtn.type = "button";
      helpBtn.className = "panel-help tool-button";
      helpBtn.title = "Hjälp";
      helpBtn.style.setProperty("--icon", "var(--black-icon-info)");

      helpBtn.addEventListener("pointerdown", stop);
      helpBtn.addEventListener("mousedown", stop);
      helpBtn.addEventListener("pointerup", stop);
      helpBtn.addEventListener("mouseup", stop);

      helpBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const html =
          (toolName && TOOL_INSTRUCTIONS[toolName]) ? TOOL_INSTRUCTIONS[toolName] : DEFAULT_INSTRUCTION;

        showToolHelp({
          title: toolTitle || "Hjälp",
          html,
        });
      });

      header.appendChild(helpBtn);
    }

    // ---------- CLOSE ----------
    if (!header.querySelector(".panel-close")) {
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "panel-close tool-button";
      closeBtn.title = "Stäng";
      closeBtn.style.setProperty("--icon", "var(--black-icon-close)");

      closeBtn.addEventListener("pointerdown", stop);
      closeBtn.addEventListener("mousedown", stop);
      closeBtn.addEventListener("pointerup", stop);
      closeBtn.addEventListener("mouseup", stop);

  closeBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (typeof onClose === "function") {
          await onClose();
        } else {
          await safeStop(api);
        }

        panel.style.display = "none";
      });

      header.appendChild(closeBtn);
    }
  };

  tryAttach();
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
async function closeOtherExclusive(
  currentName,
  exclusiveTools,
  exclusivePanels,
  exclusiveApis
) {
  for (const name of exclusiveTools) {
    if (name === currentName) continue;

    const otherPanel = exclusivePanels[name];
    const otherApi = exclusiveApis[name];

    if (otherPanel?.style.display === "flex") {
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
    const imgSrc = isMobile ? mobileSrc : desktopSrc;

    const navImg = document.createElement("img");
    navImg.src = imgSrc;
    navImg.className = "popup-navigation-img";
    navImg.title = "Klicka för att få en större bild";
    navImg.alt = tool.toolTip;

    // Toggle fullscreen on click
    navImg.addEventListener("click", () => navImg.classList.toggle("fullscreen"));

    popup.appendChild(navImg);

    const closeBtn = document.createElement("button");
    closeBtn.className = "info-popup-close";
    closeBtn.textContent = "Stäng";
    closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
    popup.appendChild(closeBtn);
  }

  // Show popup
  overlay.classList.remove("hidden");
}

function showToolHelp({ title, html }) {
  let overlay = document.getElementById("tool-help-overlay");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "tool-help-overlay";
    overlay.className = "info-overlay hidden";
    document.body.appendChild(overlay);

    const popup = document.createElement("div");
    popup.className = "info-popup";
    overlay.appendChild(popup);

    const header = document.createElement("div");
    header.className = "info-popup-header";
    popup.appendChild(header);

    const content = document.createElement("div");
    content.className = "info-popup-content";
    popup.appendChild(content);

    const closeBtn = document.createElement("button");
    closeBtn.className = "info-popup-close";
    closeBtn.textContent = "Stäng";
    closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
    popup.appendChild(closeBtn);
  }

  overlay.querySelector(".info-popup-header").textContent = title;
  overlay.querySelector(".info-popup-content").innerHTML = html; // om du vill ha HTML
  overlay.classList.remove("hidden");
}