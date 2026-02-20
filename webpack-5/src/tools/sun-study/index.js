// src/tools/sun-study/index.js

import { JulianDate } from "cesium";
import "./style.css";

/**
 * Initializes the "Sun Study" tool.
 *
 * This panel allows the user to:
 *  - Toggle Cesium shadows on/off
 *  - Select month, date, and time of day
 *  - Automatically update Cesium's clock to simulate sunlight
 *  - Adjust the date slider dynamically based on month length
 *
 * The tool updates:
 *  - viewer.clock.currentTime
 *  - viewer.shadows
 *
 * @param {HTMLElement} container - The panel container
 * @param {Viewer} viewer - The Cesium Viewer instance
 */
export default function initSunStudy(container, viewer) {

  // ------------------------------------------------------------
  // 1) Panel header
  // ------------------------------------------------------------
  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = "Solstudie";
  container.appendChild(header);

  // ------------------------------------------------------------
  // 2) Content wrapper
  // ------------------------------------------------------------
  const content = document.createElement("div");
  content.className = "panel-content";
  container.appendChild(content);

  // ------------------------------------------------------------
  // 3) Shadow toggle button
  // ------------------------------------------------------------
  const btn = document.createElement("button");
  btn.id = "sun-study-btn";
  btn.textContent = "Aktivera";
  content.appendChild(btn);
  content.appendChild(document.createElement("br"));

  // ------------------------------------------------------------
  // Month block
  // ------------------------------------------------------------
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
  // Date block
  // ------------------------------------------------------------
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
  // Time block
  // ------------------------------------------------------------
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
  // CEST note
  // ------------------------------------------------------------
  const cestNote = document.createElement("span");
  cestNote.textContent = "(CEST+1)";
  content.appendChild(cestNote);

  // ------------------------------------------------------------
  // Month names for display
  // ------------------------------------------------------------
  const months = [
    "Januari","Februari","Mars","April","Maj","Juni",
    "Juli","Augusti","September","Oktober","November","December"
  ];

  // ------------------------------------------------------------
  // Update Cesium clock + shadows
  // ------------------------------------------------------------
  function updateCesiumTimeAndShadows(m, d, t) {
    // Construct a JS Date using current year, selected month/day/time
    const date = new Date(new Date().getFullYear(), m - 1, d, t, 0, 0);

    // Update Cesium's internal time
    viewer.clock.currentTime = JulianDate.fromDate(date);

    // Ensure shadows are enabled when adjusting time
    viewer.shadows = true;

    updateShadowButtonText();
  }

  // ------------------------------------------------------------
  // Update button text + CSS class based on shadow state
  // ------------------------------------------------------------
  function updateShadowButtonText() {
    const shadowsOn = viewer.shadows;

    btn.textContent = shadowsOn
      ? "Avaktivera skuggor"
      : "Aktivera skuggor";

    btn.classList.toggle("shadow-active", shadowsOn);
  }

  // Initialize button state
  updateShadowButtonText();

  // ------------------------------------------------------------
  // Event listeners
  // ------------------------------------------------------------

  // Toggle shadows on/off
  btn.addEventListener("click", () => {
    viewer.shadows = !viewer.shadows;
    updateShadowButtonText();
  });

  // Month slider
  monthSlider.addEventListener("input", () => {
    const m = parseInt(monthSlider.value, 10);
    const d = parseInt(dateSlider.value, 10);
    const t = parseFloat(timeSlider.value);

    updateCesiumTimeAndShadows(m, d, t);

    // Update month label
    monthValue.textContent = months[m - 1];

    // Adjust date slider max based on month length
    const daysInMonth = new Date(new Date().getFullYear(), m, 0).getDate();

    if (d > daysInMonth) {
      dateSlider.value = daysInMonth.toString();
      dateValue.textContent = daysInMonth.toString();
    }

    dateSlider.max = daysInMonth.toString();
  });

  // Date slider
  dateSlider.addEventListener("input", () => {
    const m = parseInt(monthSlider.value, 10);
    const d = parseInt(dateSlider.value, 10);
    const t = parseFloat(timeSlider.value);

    updateCesiumTimeAndShadows(m, d, t);

    dateValue.textContent = d.toString();
  });

  // Time slider
  timeSlider.addEventListener("input", () => {
    const m = parseInt(monthSlider.value, 10);
    const d = parseInt(dateSlider.value, 10);
    const t = parseFloat(timeSlider.value);

    updateCesiumTimeAndShadows(m, d, t);

    // Format time as HH:MM
    const hours = Math.floor(t);
    const minutes = (t - hours) * 60;
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");

    timeValue.textContent = `${hh}:${mm}`;
  });
}
