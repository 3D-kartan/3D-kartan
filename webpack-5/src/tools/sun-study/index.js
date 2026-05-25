// src/tools/sun-study/index.js

import { JulianDate } from "cesium";
import "./style.css";

/**
 * Initialize the "Sun Study" tool panel.
 *
 * What this tool does:
 * - Lets the user enable/disable Cesium shadows
 * - Lets the user choose month, day, and time of day
 * - Updates Cesium's clock to simulate sunlight for the selected local date/time
 * - Keeps the day slider valid for the selected month (for example, February has fewer days)
 *
 * Main side effects:
 * - Updates `viewer.clock.currentTime`
 * - Updates `viewer.shadows`
 *
 * Notes:
 * - The selected time is interpreted as LOCAL time in the user's browser.
 * - The time slider uses 30-minute steps (`0.5` hours).
 * - Turning shadows on resets the UI to the current local date/time before applying it.
 *
 * @param {HTMLElement} container - The panel element where this tool should render its UI.
 * @param {import("cesium").Viewer} viewer - The Cesium Viewer instance.
 */
export default function initSunStudy(container, viewer) {
  // Toolbar button for this tool.
  // Used only to reflect shadow state visually on the tool button itself.
  const toolbarBtn = document.getElementById("tool-btn-sun-study");

  // ------------------------------------------------------------
  // 1) Panel header
  // ------------------------------------------------------------
  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = "Solstudie";
  container.appendChild(header);

  // ------------------------------------------------------------
  // 2) Main panel content wrapper
  // ------------------------------------------------------------
  const content = document.createElement("div");
  content.className = "panel-body";
  container.appendChild(content);

  // ------------------------------------------------------------
  // 3) Shadow toggle
  // ------------------------------------------------------------
  // A simple on/off switch controlling Cesium shadows.
  const shadowRow = document.createElement("div");
  shadowRow.className = "sun-toggle-row";

  const shadowLabel = document.createElement("span");
  shadowLabel.className = "sun-toggle-label";
  shadowLabel.textContent = "Skuggor:";
  shadowRow.appendChild(shadowLabel);

  const shadowSwitch = document.createElement("label");
  shadowSwitch.className = "switch";

  const shadowCheckbox = document.createElement("input");
  shadowCheckbox.type = "checkbox";
  shadowCheckbox.id = "sun-shadow-toggle";

  const shadowSlider = document.createElement("span");
  shadowSlider.className = "slider";

  shadowSwitch.appendChild(shadowCheckbox);
  shadowSwitch.appendChild(shadowSlider);
  shadowRow.appendChild(shadowSwitch);

  content.appendChild(shadowRow);

  // ------------------------------------------------------------
  // 4) Month slider block
  // ------------------------------------------------------------
  // Lets the user choose month 1-12.
  const monthBlock = document.createElement("div");
  monthBlock.className = "sun-block";

  const monthTitle = document.createElement("div");
  monthTitle.className = "sun-title";
  monthTitle.textContent = "Månad";
  monthBlock.appendChild(monthTitle);

  const monthSlider = document.createElement("input");
  monthSlider.id = "month-slider";
  monthSlider.type = "range";
  monthSlider.min = "1";
  monthSlider.max = "12";
  monthSlider.step = "1";
  monthSlider.value = "6";
  monthSlider.className = "sun-slider";
  monthBlock.appendChild(monthSlider);

  const monthValue = document.createElement("div");
  monthValue.id = "month-slider-value";
  monthValue.className = "sun-value";
  monthValue.textContent = "Juni";
  monthBlock.appendChild(monthValue);

  content.appendChild(monthBlock);

  // ------------------------------------------------------------
  // 5) Day-of-month slider block
  // ------------------------------------------------------------
  // The maximum value is updated dynamically depending on selected month/year.
  const dateBlock = document.createElement("div");
  dateBlock.className = "sun-block";

  const dateTitle = document.createElement("div");
  dateTitle.className = "sun-title";
  dateTitle.textContent = "Datum";
  dateBlock.appendChild(dateTitle);

  const dateSlider = document.createElement("input");
  dateSlider.id = "date-slider";
  dateSlider.type = "range";
  dateSlider.min = "1";
  dateSlider.max = "31";
  dateSlider.step = "1";
  dateSlider.value = "15";
  dateSlider.className = "sun-slider";
  dateBlock.appendChild(dateSlider);

  const dateValue = document.createElement("div");
  dateValue.id = "date-slider-value";
  dateValue.className = "sun-value";
  dateValue.textContent = "15";
  dateBlock.appendChild(dateValue);

  content.appendChild(dateBlock);

  // ------------------------------------------------------------
  // 6) Time slider block
  // ------------------------------------------------------------
  // Time is represented in decimal hours:
  //   10   -> 10:00
  //   10.5 -> 10:30
  // The slider uses 30-minute increments.
  const timeBlock = document.createElement("div");
  timeBlock.className = "sun-block";

  const timeTitle = document.createElement("div");
  timeTitle.className = "sun-title";
  timeTitle.textContent = "Tid";
  timeBlock.appendChild(timeTitle);

  const timeSlider = document.createElement("input");
  timeSlider.id = "time-slider";
  timeSlider.type = "range";
  timeSlider.min = "0.5";
  timeSlider.max = "24";
  timeSlider.step = "0.5";
  timeSlider.value = "10";
  timeSlider.className = "sun-slider";
  timeBlock.appendChild(timeSlider);

  const timeValue = document.createElement("div");
  timeValue.id = "time-slider-value";
  timeValue.className = "sun-value";
  timeValue.textContent = "10:00";
  timeBlock.appendChild(timeValue);

  content.appendChild(timeBlock);

  // ------------------------------------------------------------
  // 7) Informational note
  // ------------------------------------------------------------
  // Indicates to the user that local time handling is intended to follow
  // seasonal time changes (summer/winter time) through the browser's Date handling.
  const localNote = document.createElement("span");
  localNote.textContent = "Sommar- och vintertidsanpassad";
  content.appendChild(localNote);

  // ------------------------------------------------------------
  // Month names used for display
  // ------------------------------------------------------------
  const months = [
    "Januari",
    "Februari",
    "Mars",
    "April",
    "Maj",
    "Juni",
    "Juli",
    "Augusti",
    "September",
    "Oktober",
    "November",
    "December",
  ];

  // ------------------------------------------------------------
  // Helper functions
  // ------------------------------------------------------------

  /**
   * Update the day slider so it matches the number of days in the selected month.
   *
   * Example:
   * - February may become max 28 or 29
   * - April becomes max 30
   * - July becomes max 31
   *
   * If the current selected day is larger than the allowed max for the month,
   * it is clamped down automatically.
   *
   * @param {number} year - Full year, for example 2026.
   * @param {number} month1to12 - Month number in the range 1..12.
   */
  function setDateSliderMaxForMonth(year, month1to12) {
    // In JS Date, using day 0 gives the last day of the previous month.
    // So `new Date(year, month1to12, 0)` gives the last day of the selected month.
    const daysInMonth = new Date(year, month1to12, 0).getDate();
    dateSlider.max = String(daysInMonth);

    // Clamp the currently selected date if it no longer fits in the new month.
    const d = parseInt(dateSlider.value, 10);
    if (d > daysInMonth) {
      dateSlider.value = String(daysInMonth);
      dateValue.textContent = String(daysInMonth);
    }
  }

  /**
   * Convert a decimal hour value to an HH:MM string.
   *
   * Examples:
   * - 10   -> "10:00"
   * - 10.5 -> "10:30"
   * - 7.5  -> "07:30"
   *
   * @param {number} t - Time in decimal hours.
   * @returns {string} Time label formatted as HH:MM.
   */
  function formatTimeLabel(t) {
    const hours = Math.floor(t);
    const minutes = Math.round((t - hours) * 60);
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  /**
   * Set all UI sliders and labels from a JavaScript Date object.
   *
   * This is used mainly when initializing the panel and when shadows are turned on,
   * so the controls reflect the current local date/time.
   *
   * Important details:
   * - Month is converted from JS format (0..11) to UI format (1..12)
   * - Time is rounded to the nearest 0.5 hour to match the time slider step
   * - Time is clamped to the slider range [0.5, 24]
   *
   * @param {Date} date - Local browser date/time.
   */
  function setUIFromLocalDate(date) {
    const year = date.getFullYear();
    const m = date.getMonth() + 1; // Convert JS month 0..11 -> UI month 1..12
    const d = date.getDate();

    // Convert local time to decimal hours and round to nearest 30 minutes.
    const tRaw = date.getHours() + date.getMinutes() / 60;
    const t = Math.round(tRaw * 2) / 2;

    monthSlider.value = String(m);
    monthValue.textContent = months[m - 1];

    setDateSliderMaxForMonth(year, m);

    dateSlider.value = String(Math.min(d, parseInt(dateSlider.max, 10)));
    dateValue.textContent = dateSlider.value;

    const clampedT = Math.max(0.5, Math.min(24, t));
    timeSlider.value = String(clampedT);
    timeValue.textContent = formatTimeLabel(clampedT);
  }

  /**
   * Apply the selected month/day/time to Cesium's clock and ensure shadows are enabled.
   *
   * The date is built using the CURRENT YEAR and the selected month/day/time,
   * interpreted in the browser's local timezone.
   *
   * Why local time?
   * Because the UI is intended to behave like a user-facing local "sun study"
   * control, rather than requiring manual UTC input.
   *
   * @param {number} m - Month in range 1..12.
   * @param {number} d - Day in range 1..31 (already constrained by slider max).
   * @param {number} t - Decimal hour, for example 10 or 10.5.
   */
  function updateCesiumTimeAndShadows(m, d, t) {
    const year = new Date().getFullYear();
    const hours = Math.floor(t);
    const minutes = Math.round((t - hours) * 60);

    // Create a local JS Date from current year + selected controls.
    const date = new Date(year, m - 1, d, hours, minutes, 0);

    // Convert JS Date -> Cesium JulianDate and update the viewer clock.
    viewer.clock.currentTime = JulianDate.fromDate(date);

    // Whenever the user actively changes the sun study controls,
    // shadows should be enabled automatically.
    viewer.shadows = true;

    updateShadowToggleUI();
  }

  /**
   * Read the current slider values and apply them to Cesium.
   */
  function applyUIToCesium() {
    const m = parseInt(monthSlider.value, 10);
    const d = parseInt(dateSlider.value, 10);
    const t = parseFloat(timeSlider.value);
    updateCesiumTimeAndShadows(m, d, t);
  }

  /**
   * Sync the shadow checkbox and toolbar button styling with the current viewer state.
   *
   * This function does not change Cesium state by itself.
   * It only reflects current state in the UI.
   */
  function updateShadowToggleUI() {
    const shadowsOn = viewer.shadows;

    shadowCheckbox.checked = shadowsOn;

    if (toolbarBtn) {
      toolbarBtn.classList.toggle("shadow-active", shadowsOn);
    }
  }

  // ------------------------------------------------------------
  // Initial UI state
  // ------------------------------------------------------------
  // Start by reflecting the user's current local date/time in the sliders.
  // This means the default UI is dynamic, not hardcoded.
  setUIFromLocalDate(new Date());
  updateShadowToggleUI();

  // ------------------------------------------------------------
  // Event listeners
  // ------------------------------------------------------------

  /**
   * Shadow checkbox behavior:
   * - If turning ON:
   *   - reset sliders to current local date/time
   *   - apply that date/time to Cesium
   *   - ensure shadows become enabled
   * - If turning OFF:
   *   - simply disable shadows
   */
  shadowCheckbox.addEventListener("change", () => {
    const turningOn = shadowCheckbox.checked;

    if (turningOn) {
      setUIFromLocalDate(new Date());
      applyUIToCesium(); // Also enables viewer.shadows
    } else {
      viewer.shadows = false;
    }

    updateShadowToggleUI();
  });

  /**
   * Month slider:
   * - update visible month label
   * - recalculate allowed number of days for that month
   * - clamp selected day if needed
   * - apply the updated date/time to Cesium
   */
  monthSlider.addEventListener("input", () => {
    const m = parseInt(monthSlider.value, 10);
    const year = new Date().getFullYear();

    monthValue.textContent = months[m - 1];
    setDateSliderMaxForMonth(year, m);

    // The day may have been clamped by the month change, so refresh the label too.
    dateValue.textContent = dateSlider.value;

    applyUIToCesium();
  });

  /**
   * Day slider:
   * - update visible day label
   * - apply the updated date/time to Cesium
   */
  dateSlider.addEventListener("input", () => {
    dateValue.textContent = dateSlider.value;
    applyUIToCesium();
  });

  /**
   * Time slider:
   * - update visible HH:MM label
   * - apply the updated date/time to Cesium
   */
  timeSlider.addEventListener("input", () => {
    const t = parseFloat(timeSlider.value);
    timeValue.textContent = formatTimeLabel(t);
    applyUIToCesium();
  });
}