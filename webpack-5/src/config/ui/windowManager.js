// src/config/ui/windowManager.js

export const windowManager = {
  // Base z-index for all tool panels
  zIndex: 1000,

  // Desktop breakpoint
  desktopBreakpoint: 640,

  // Default margin
  defaultMargin: 10,

  // Reserved space on the right when the project sidebar is open on desktop
  projectSidebarRightMargin: 400,

  // Keeps track of all registered panels
  panels: new Set(),

  // So we don't start multiple observers
  sidebarObserverInitialized: false,

  bringToFront(el) {
    el.style.zIndex = ++this.zIndex;
  },

  isDesktop() {
    return window.matchMedia(`(min-width: ${this.desktopBreakpoint}px)`).matches;
  },

  isProjectSidebarOpen() {
    const sidebar = document.getElementById("projectSidebar");
    if (!sidebar) return false;

    return window.getComputedStyle(sidebar).display === "block";
  },

  getRightMargin() {
    if (this.isDesktop() && this.isProjectSidebarOpen()) {
      return this.projectSidebarRightMargin;
    }
    return this.defaultMargin;
  },

  registerPanel(panel) {
    if (!panel) return;
    this.panels.add(panel);
  },

  refreshAllPanels() {
    this.panels.forEach((panel) => {
      this.keepInViewport(panel);
    });
  },

  initProjectSidebarObserver() {
    if (this.sidebarObserverInitialized) return;
    this.sidebarObserverInitialized = true;

    const sidebar = document.getElementById("projectSidebar");
    if (!sidebar) return;

    const updatePanels = () => {
      requestAnimationFrame(() => {
        this.refreshAllPanels();
      });
    };

    const observer = new MutationObserver(() => {
      updatePanels();
    });

    observer.observe(sidebar, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden"]
    });

    // Extra safety if layout changes
    window.addEventListener("resize", updatePanels);
  },

  keepInViewport(panel, margin = 10) {
    if (!panel) return;

    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;

    if (!panelWidth || !panelHeight) return;

    let left = panel.offsetLeft;
    let top = panel.offsetTop;

    const rightMargin = this.getRightMargin();

    const maxLeft = Math.max(margin, window.innerWidth - panelWidth - rightMargin);
    const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);

    left = Math.min(Math.max(margin, left), maxLeft);
    top = Math.min(Math.max(margin, top), maxTop);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  },

  makeDraggable(panel, handle) {
    let startX, startY, dragging = false;
    let activePointerId = null;

    this.registerPanel(panel);
    this.initProjectSidebarObserver();

    if (handle && handle.style) {
      handle.style.touchAction = "none";
      handle.style.userSelect = "none";
    }

    requestAnimationFrame(() => {
      this.keepInViewport(panel);
    });

    window.addEventListener("resize", () => {
      this.keepInViewport(panel);
    });

    handle.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;

      dragging = true;
      activePointerId = e.pointerId;

      startX = e.clientX - panel.offsetLeft;
      startY = e.clientY - panel.offsetTop;

      this.bringToFront(panel);

      if (handle.setPointerCapture) {
        handle.setPointerCapture(activePointerId);
      }

      e.preventDefault();
    });

    document.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      if (activePointerId !== null && e.pointerId !== activePointerId) return;

      let x = e.clientX - startX;
      let y = e.clientY - startY;

      const margin = this.defaultMargin;
      const rightMargin = this.getRightMargin();

      const maxX = Math.max(margin, window.innerWidth - panel.offsetWidth - rightMargin);
      const maxY = Math.max(margin, window.innerHeight - panel.offsetHeight - margin);

      x = Math.min(Math.max(margin, x), maxX);
      y = Math.min(Math.max(margin, y), maxY);

      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    });

    const stopDragging = (e) => {
      if (!dragging) return;
      if (activePointerId !== null && e && e.pointerId !== activePointerId) return;

      dragging = false;
      activePointerId = null;
    };

    document.addEventListener("pointerup", stopDragging);
    document.addEventListener("pointercancel", stopDragging);
  }
};