// src/ui/menu.js

// Import menu feature modules
import { takeScreenshot } from "./menuFunctions/print/print.js";
import { initCoordinates } from "./menuFunctions/coordinates/coordinates.js";
import { shareView } from "./menuFunctions/shareMap/shareMap.js";
import { initPicking } from "./menuFunctions/picking/picking.js";
import { initResolution } from "./menuFunctions/resolution/resolution.js";

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
    { icon: "--black-icon-gps",   text: "Visa koordinater", id: "coordRow", hasSwitch: true },
    { icon: "--black-icon-arrow-selector-tool", text: "Visa selektering", id: "pickingRow", hasSwitch: true },
    {
      icon: "--black-icon-display-settings",
      text: "Upplösning",
      id: "resolutionRow",
      hasDropdown: true,
      dropdownOptions: [
        { value: "low",    label: "Låg" },
        { value: "medium", label: "Medel", selected: true },
        { value: "high",   label: "Hög" }
      ]
    }
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
          <input type="checkbox" id="${row.id}Checkbox">
          <span class="slider"></span>
        </label>
      ` : ""}
      ${row.hasDropdown ? `
        <div class="custom-dropdown" id="${row.id}Dropdown">
          <button class="custom-dropdown-btn" type="button">${(row.dropdownOptions.find(o => o.selected) || row.dropdownOptions[0]).label}</button>
          <ul class="custom-dropdown-list">
            ${row.dropdownOptions.map(o =>
              `<li class="custom-dropdown-option${o.selected ? " selected" : ""}" data-value="${o.value}">${o.label}</li>`
            ).join("")}
          </ul>
        </div>
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

    document.getElementById("coordRowCheckbox")
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
  let teardownPicking = null;

document.getElementById("pickingRowCheckbox")
  .addEventListener("change", (e) => {
    if (e.target.checked) {
      teardownPicking = initPicking(viewer);
    } else if (teardownPicking) {
      teardownPicking();
      teardownPicking = null;
    }
  });

  // ------------------------------------------------------------
  // Resolution dropdown
  // ------------------------------------------------------------
  const setResolution = initResolution(viewer);

  const resDropdown = document.getElementById("resolutionRowDropdown");
  const resBtn      = resDropdown.querySelector(".custom-dropdown-btn");
  const resList     = resDropdown.querySelector(".custom-dropdown-list");
  const resOptions  = resDropdown.querySelectorAll(".custom-dropdown-option");

  resBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    resList.classList.toggle("open");
  });

  resOptions.forEach(opt => {
    opt.addEventListener("click", () => {
      resBtn.childNodes[0].textContent = opt.textContent;
      resList.classList.remove("open");
      resOptions.forEach(o => o.classList.remove("selected"));
      opt.classList.add("selected");
      setResolution(opt.dataset.value);
    });
  });

  document.addEventListener("click", () => {
    resList.classList.remove("open");
  });
}
