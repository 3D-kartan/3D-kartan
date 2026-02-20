// src/ui/menuFunctions/print.js

// CSS for screenshot overlay styling
import "./print.css";

/**
 * Creates and displays a full‑screen overlay while the screenshot is being generated.
 * This gives the user visual feedback that the process is running.
 */
function showOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "screenshot-overlay";

  // Inline styling ensures the overlay always works regardless of external CSS
  Object.assign(overlay.style, {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background: "rgba(0, 0, 0, 0.8)",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "24px",
    zIndex: 10000,
    opacity: "1",
    transition: "opacity 0.3s ease"
  });

  overlay.innerText = "Genererar skärmklipp...";
  document.body.appendChild(overlay);
}

/**
 * Fades out and removes the screenshot overlay.
 * Called after the PNG has been generated and download triggered.
 */
function hideOverlay() {
  const overlay = document.getElementById("screenshot-overlay");
  if (!overlay) return;

  overlay.style.opacity = "0";
  setTimeout(() => overlay.remove(), 300);
}

/**
 * Formats a timestamp into a compact filename-friendly string.
 * Example: 20250218_143012
 *
 * @param {JulianDate | number | Date} time - Time used for naming the screenshot
 * @returns {string}
 */
function getFormattedTimestamp(time) {
  const date = new Date(time);
  const pad = n => n.toString().padStart(2, "0");

  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "_" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

/**
 * Captures a screenshot of the Cesium viewer canvas and downloads it as a PNG.
 * A temporary overlay is shown during the process.
 *
 * @param {Viewer} viewer - The Cesium Viewer instance
 */
export async function takeScreenshot(viewer) {
  // Show loading overlay
  showOverlay();

  // Ensure the frame is fully rendered before capturing
  await viewer.render();

  const canvas = viewer.scene.canvas;

  // Use Cesium's current clock time for filename timestamp
  const timestamp = getFormattedTimestamp(viewer.clock.currentTime);
  const filename  = `screenshot_${timestamp}.png`;

  // Convert canvas to PNG blob and trigger download
  canvas.toBlob(blob => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();

    // Hide overlay after a short delay to ensure the click has fired
    setTimeout(hideOverlay, 500);
  });
}
