// src/ui/clippingSpecResolver.js
const geoJsonPromiseCache = new Map();

function normalizeSpec(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
}

export function flattenLonLatPairs(pairs = []) {
  const out = [];
  for (const p of pairs) {
    if (!Array.isArray(p) || p.length < 2) continue;

    const lon = Number(p[0]);
    const lat = Number(p[1]);

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push(lon, lat);
  }
  return out;
}

function closeRingIfNeeded(ringPairs) {
  if (!Array.isArray(ringPairs) || ringPairs.length === 0) return ringPairs;

  const [aLon, aLat] = ringPairs[0];
  const [bLon, bLat] = ringPairs[ringPairs.length - 1];

  if (aLon !== bLon || aLat !== bLat) {
    return [...ringPairs, ringPairs[0]];
  }

  return ringPairs;
}

function pickOuterRingFromGeoJsonGeometry(geom, polygonIndex = 0) {
  if (!geom) return null;

  if (geom.type === "Polygon") {
    return geom.coordinates?.[0] ?? null;
  }

  if (geom.type === "MultiPolygon") {
    return geom.coordinates?.[polygonIndex]?.[0] ?? null;
  }

  return null;
}

async function loadGeoJson(url, { fetchImpl = fetch } = {}) {
  if (!url || typeof url !== "string") {
    throw new Error("GeoJSON-url saknas eller är ogiltig");
  }

  let promise = geoJsonPromiseCache.get(url);

  if (!promise) {
    promise = (async () => {
      const res = await fetchImpl(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Kunde inte hämta GeoJSON (${res.status}) från ${url}`);
      }
      return res.json();
    })();

    geoJsonPromiseCache.set(url, promise);
  }

  try {
    return await promise;
  } catch (e) {
    geoJsonPromiseCache.delete(url);
    throw e;
  }
}

/**
 * Returnerar rätt clipping-spec för valt mål, med fallback:
 * - terrain  -> terrainClipping ?? tilesetClipping
 * - tileset  -> tilesetClipping ?? terrainClipping
 */
export function getClippingSpecInfo(project, target) {
  const terrainSpec = normalizeSpec(project?.terrainClipping);
  const tilesetSpec = normalizeSpec(project?.tilesetClipping);

  if (target === "terrain") {
    if (terrainSpec) {
      return {
        spec: terrainSpec,
        sourceKey: "terrainClipping",
        fallbackUsed: false
      };
    }

    if (tilesetSpec) {
      return {
        spec: tilesetSpec,
        sourceKey: "tilesetClipping",
        fallbackUsed: true
      };
    }

    return null;
  }

  if (target === "tileset") {
    if (tilesetSpec) {
      return {
        spec: tilesetSpec,
        sourceKey: "tilesetClipping",
        fallbackUsed: false
      };
    }

    if (terrainSpec) {
      return {
        spec: terrainSpec,
        sourceKey: "terrainClipping",
        fallbackUsed: true
      };
    }

    return null;
  }

  throw new Error(`Okänt clipping target: ${target}`);
}

export function projectHasClippingSpec(project, target) {
  return !!getClippingSpecInfo(project, target);
}

export function hasInlineClippingPositions(project, target) {
  const info = getClippingSpecInfo(project, target);
  return !!(
    info?.spec &&
    Array.isArray(info.spec.positions) &&
    info.spec.positions.length >= 3
  );
}

export function getInlineClippingPositions(project, target) {
  const info = getClippingSpecInfo(project, target);
  if (!Array.isArray(info?.spec?.positions)) return null;
  return info.spec.positions;
}

export function getClippingMaxPoints(project, target, defaultValue = 5000) {
  const info = getClippingSpecInfo(project, target);
  return info?.spec?.maxPoints ?? defaultValue;
}

export async function resolveClippingPositionsFromProject(
  project,
  target,
  { fetchImpl = fetch } = {}
) {
  const info = getClippingSpecInfo(project, target);
  if (!info?.spec) return null;

  const spec = info.spec;

  // Inline coordinates
  if (Array.isArray(spec.positions)) {
    return spec.positions;
  }

  // GeoJSON URL
  if (typeof spec.url === "string" && spec.url.length) {
    const gj = await loadGeoJson(spec.url, { fetchImpl });

    const featureIndex = spec.featureIndex ?? 0;
    const polygonIndex = spec.polygonIndex ?? 0;

    const feature =
      gj?.type === "Feature"
        ? gj
        : gj?.type === "FeatureCollection"
          ? gj.features?.[featureIndex]
          : null;

    if (!feature?.geometry) {
      throw new Error("GeoJSON saknar Feature.geometry");
    }

    const ring = pickOuterRingFromGeoJsonGeometry(
      feature.geometry,
      polygonIndex
    );

    if (!Array.isArray(ring)) {
      throw new Error("Geometry måste vara Polygon/MultiPolygon (ytterring)");
    }

    let pairs = ring
      .map((c) => [Number(c?.[0]), Number(c?.[1])])
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));

    pairs = closeRingIfNeeded(pairs);

    return pairs;
  }

  return null;
}