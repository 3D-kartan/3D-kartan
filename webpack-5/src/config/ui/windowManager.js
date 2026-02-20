// src/config/ui/windowManager.js

/**
 * A small utility module responsible for:
 *  - Managing z-index stacking of floating tool panels
 *  - Making panels draggable via their header/handle
 *
 * This keeps the UI windows behaving like lightweight desktop windows:
 *  - The most recently interacted panel is brought to the front
 *  - Panels can be dragged but are clamped within the viewport
 */
export const windowManager = {
  // Base z-index for all tool panels
  zIndex: 1000,

  /**
   * Brings a panel to the front by increasing its z-index.
   * Ensures that the most recently interacted window is on top.
   *
   * @param {HTMLElement} el - The panel element to bring forward
   */
  bringToFront(el) {
    el.style.zIndex = ++this.zIndex;
  },

  /**
   * Makes a panel draggable by clicking and dragging its handle element.
   * Dragging is clamped to the viewport so the panel cannot be dragged off-screen.
   *
   * @param {HTMLElement} panel  - The panel to move
   * @param {HTMLElement} handle - The element that acts as the drag handle (usually the header)
   */
  makeDraggable(panel, handle) {
    let startX, startY, dragging = false;

    // Start dragging when mouse is pressed on the handle
    handle.addEventListener("mousedown", (e) => {
      dragging = true;

      // Calculate offset between mouse and panel position
      startX = e.clientX - panel.offsetLeft;
      startY = e.clientY - panel.offsetTop;

      // Bring panel to front when dragging begins
      this.bringToFront(panel);

      e.preventDefault();
    });

    // Move panel while dragging
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;

      // Proposed new position
      let x = e.clientX - startX;
      let y = e.clientY - startY;

      // Clamp within viewport boundaries
      const maxX = window.innerWidth  - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;

      x = Math.min(Math.max(0, x), maxX);
      y = Math.min(Math.max(0, y), maxY);

      panel.style.left = x + "px";
      panel.style.top  = y + "px";
    });

    // Stop dragging on mouse release
    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }
};
