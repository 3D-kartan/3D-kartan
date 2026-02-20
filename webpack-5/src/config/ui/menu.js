// src/ui/menu.js

// Import menu feature modules
import { takeScreenshot } from "./menuFunctions/print/print.js";
import { initCoordinates } from "./menuFunctions/coordinates/coordinates.js";
import { shareView } from "./menuFunctions/shareMap/shareMap.js";

/**
 * Initializes the top‑right menu UI.
 *
 * Features:
 *  - A toggleable menu box with multiple menu actions
 *  - Share map link
 *  - Screenshot tool
 *  - Coordinate display toggle (desktop only)
 *  - Mobile‑aware behavior (hides coordinate row on small screens)
 *
 * @param {Viewer} viewer - Cesium Viewer instance
 * @param {object} config - Global config object (contains proj4Defs)
 */
export default function initMenuUI(viewer, config) {

  // ------------------------------------------------------------
  // Wrapper for the menu button + menu content
  // ------------------------------------------------------------
  const wrapper = document.createElement("div");
  wrapper.id = "topRightMenu";
  document.body.appendChild(wrapper);

  // ------------------------------------------------------------
  // Menu toggle button (top‑right icon)
  // ------------------------------------------------------------
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "tool-button";
  toggleBtn.title = "Meny";
  toggleBtn.style.setProperty("--icon", "var(--black-icon-menu)");
  wrapper.appendChild(toggleBtn);

  // ------------------------------------------------------------
  // The menu box itself (hidden by default)
  // ------------------------------------------------------------
  const menuBox = document.createElement("div");
  menuBox.id = "menuBox";
  menuBox.style.display = "none";
  wrapper.appendChild(menuBox);

  // ------------------------------------------------------------
  // Close button inside the menu
  // ------------------------------------------------------------
  const closeBtn = document.createElement("button");
  closeBtn.className = "tool-button";
  closeBtn.title = "Stäng";
  closeBtn.style.setProperty("--icon", "var(--black-icon-close)");
  closeBtn.id = "menuCloseBtn";
  menuBox.appendChild(closeBtn);

  // ------------------------------------------------------------
  // Menu rows (icon + label + optional switch)
  // ------------------------------------------------------------
  const rows = [
    { icon: "--black-icon-share", text: "Dela karta",     id: "shareMapBtn" },
    { icon: "--black-icon-print", text: "Ta skärmklipp",  id: "screenshotBtn" },
    { icon: "--black-icon-gps",   text: "Visa koordinater", id: "coordRow", hasSwitch: true }
  ];

  // Hide coordinate row on mobile
  const isMobile = window.matchMedia("(max-width: 600px)").matches;

  rows.forEach(row => {

    // Skip coordinate row on mobile
    if (isMobile && row.id === "coordRow") {
      return;
    }

    const btn = document.createElement("div");
    btn.className = "menu-row";
    btn.id = row.id;

    // Build row HTML
    btn.innerHTML = `
      <span class="menu-icon" style="background-image: var(${row.icon})"></span>
      <span class="menu-label">${row.text}</span>
      ${row.hasSwitch ? `
        <label class="switch">
          <input type="checkbox" id="coordCheckbox">
          <span class="slider"></span>
        </label>
      ` : ""}
    `;

    menuBox.appendChild(btn);
  });

  // ------------------------------------------------------------
  // Menu open/close behavior
  // ------------------------------------------------------------
  toggleBtn.addEventListener("click", () => {
    const open = menuBox.style.display === "block";
    menuBox.style.display = open ? "none" : "block";
  });

  closeBtn.addEventListener("click", () => {
    menuBox.style.display = "none";
  });

  // ------------------------------------------------------------
  // Menu actions
  // ------------------------------------------------------------

  // Share map
  document.getElementById("shareMapBtn").addEventListener("click", () => {
    console.log("Dela karta");
    shareView(viewer);
  });

  // Screenshot
  document.getElementById("screenshotBtn").addEventListener("click", () => {
    console.log("Ta skärmklipp");
    takeScreenshot(viewer);
  });

  // ------------------------------------------------------------
  // Coordinate display toggle (desktop only)
  // ------------------------------------------------------------
  if (!isMobile) {
    let teardownCoords = null;

    document.getElementById("coordCheckbox")
      .addEventListener("change", e => {
        if (e.target.checked) {
          // Start coordinate display tool
          teardownCoords = initCoordinates(viewer, config.proj4Defs);
        } else if (teardownCoords) {
          // Stop coordinate display tool
          teardownCoords();
          teardownCoords = null;
        }
      });
  }
}
