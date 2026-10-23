// src/config/ui/menuFunctions/coordinates/precision.js

const DEFAULT_PRECISION = Object.freeze({ E: 3, N: 3, Z: 1 });

/**
 * Returns a valid number of decimals, or the fallback when the configured
 * value is not an integer between 0 and 10 (toFixed accepts 0-100).
 */
function readDecimals(value, fallback) {
  return Number.isInteger(value) && value >= 0 && value <= 10
    ? value
    : fallback;
}

/**
 * Normalizes the "displayed-coordinate-precision" entry from index.json
 * into { E, N, Z } decimals, using defaults for missing or invalid values.
 *
 * @param {object} [precision] - e.g. { E: 3, N: 3, Z: 2 }
 * @returns {{E: number, N: number, Z: number}}
 */
export function normalizePrecision(precision) {
  return {
    E: readDecimals(precision?.E, DEFAULT_PRECISION.E),
    N: readDecimals(precision?.N, DEFAULT_PRECISION.N),
    Z: readDecimals(precision?.Z, DEFAULT_PRECISION.Z)
  };
}
