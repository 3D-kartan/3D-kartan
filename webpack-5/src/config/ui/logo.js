/**
 * Logo initialization utility for the application UI.
 *
 * Purpose:
 *  - Reads logo configuration from the global config object.
 *  - Dynamically imports a PNG logo asset based on the configured file name.
 *  - Renders the logo either inside the top-right menu or centered at the bottom
 *    of the application, depending on the "logoLocation" setting.
 *
 * Key behaviors:
 *  - The logo is only displayed if "useLogo" is true and a valid file name is provided.
 *  - The logo file is loaded through a dynamic import using the @imgs alias.
 *  - If "logoLocation" is "top-right-menu", the logo is inserted into the element
 *    with id="menuBox". If that element does not exist, the logo falls back to <body>.
 *  - If "logoLocation" is "bottom-middle", the logo is appended to <body> and styled
 *    accordingly.
 *
 * Expected config shape:
 * {
 *   "logo": [
 *     {
 *       "useLogo": true,
 *       "logoName": "your_logo.png",
 *       "logoLocation": "top-right-menu" // or "bottom-middle"
 *     }
 *   ]
 * }
 *
 * Usage:
 *   import initLogo from "./config/ui/logo.js";
 *   initLogo(config);
 */

export default async function initLogo(config) {
  const logoConfig = Array.isArray(config.logo) ? config.logo[0] : null;
  if (!logoConfig) return;

  const { useLogo, logoName, logoLocation } = logoConfig;

  if (!useLogo || !logoName) return;

  const img = document.createElement("img");
  const logoSrc = new URL(`images/png/${encodeURIComponent(logoName)}`, document.baseURI).href;

  img.src = logoSrc;
  img.alt = "Application Logo";
  img.className = "app-logo";

  img.onerror = () => {
    console.warn("Logo file not found:", logoName, logoSrc);
    img.remove();
  };

  // ---------------------------------------------
  // TOP-RIGHT-MENU PLACEMENT
  // ---------------------------------------------
  if (logoLocation === "top-right-menu") {
    img.classList.add("logo-in-menu");

    const menuBox = document.getElementById("menuBox");
    if (menuBox) {
      menuBox.appendChild(img);
      return;
    } else {
      console.warn("menuBox not found, placing logo in body instead.");
      document.body.appendChild(img);
      return;
    }
  }

  // ---------------------------------------------
  // BOTTOM-MIDDLE PLACEMENT
  // ---------------------------------------------
  img.classList.add("logo-bottom-middle");
  document.body.appendChild(img);

  // ---------------------------------------------
  // LISTEN FOR COORDINATE TOGGLE
  // ---------------------------------------------
  const coordCheckbox = document.getElementById("coordRowCheckbox");
  
  if (coordCheckbox) {
    coordCheckbox.addEventListener("change", () => {
      if (coordCheckbox.checked) {
        img.classList.add("logo-shift-up");
      } else {
        img.classList.remove("logo-shift-up");
      }
    });
  }
}