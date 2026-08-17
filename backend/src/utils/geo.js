/**
 * Geo helpers for zone detection.
 *
 * Zones are stored as plain [[lat, lng], ...] rings drawn by the admin, so
 * everything here is pure arithmetic - no PostGIS extension required. With
 * only 8 polygons the cost of a linear scan is irrelevant.
 *
 * Distances use an equirectangular projection into local metres around a
 * reference point. Over a campus (a kilometre or two) the error is
 * centimetres, and it keeps the segment maths in plain planar coordinates.
 */

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg) => (deg * Math.PI) / 180;

/** How far outside every zone a point may be before we call it off-campus. */
export const DEFAULT_MAX_SNAP_METERS = 200;

/** Project a lat/lng into metres relative to an origin. */
function toLocalMeters(lat, lng, originLat, originLng) {
  const x = toRad(lng - originLng) * EARTH_RADIUS_M * Math.cos(toRad(originLat));
  const y = toRad(lat - originLat) * EARTH_RADIUS_M;
  return [x, y];
}

/**
 * Ray-casting point-in-polygon test.
 * Treats the ring as closed, so the caller need not repeat the first vertex.
 */
export function pointInPolygon(lat, lng, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];

    const straddles = latI > lat !== latJ > lat;
    if (!straddles) continue;

    const crossingLng = ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;
    if (lng < crossingLng) inside = !inside;
  }
  return inside;
}

/** Great-circle distance in metres. */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Shortest distance from a point to a line segment, in planar metres. */
function pointToSegmentMeters(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;

  // Degenerate segment - the two endpoints are the same point.
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);

  // Project the point onto the segment, clamped to its ends.
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));

  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Shortest distance from a point to a polygon's boundary, in metres.
 *
 * This - not distance to the centroid - is what decides which zone a
 * boundary-case complaint belongs to. A long corridor-shaped zone can have its
 * centroid hundreds of metres away while its edge is two metres away, and the
 * edge is what a person standing there would call "the zone next to me".
 */
export function distanceToPolygonEdgeMeters(lat, lng, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 2) return Infinity;

  let min = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = toLocalMeters(polygon[j][0], polygon[j][1], lat, lng);
    const [bx, by] = toLocalMeters(polygon[i][0], polygon[i][1], lat, lng);
    // The query point is the projection origin, so it sits at (0, 0).
    const d = pointToSegmentMeters(0, 0, ax, ay, bx, by);
    if (d < min) min = d;
  }
  return min;
}

/** Polygon area in square metres (shoelace, projected to local metres). */
export function polygonAreaM2(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return 0;

  const [oLat, oLng] = polygon[0];
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = toLocalMeters(polygon[i][0], polygon[i][1], oLat, oLng);
    const [xj, yj] = toLocalMeters(polygon[j][0], polygon[j][1], oLat, oLng);
    sum += xj * yi - xi * yj;
  }
  return Math.abs(sum) / 2;
}

/** Centroid of a ring, as [lat, lng]. Falls back to the vertex mean. */
export function polygonCentroid(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    if (!polygon?.length) return null;
    const lat = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
    const lng = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
    return [lat, lng];
  }

  const [oLat, oLng] = polygon[0];
  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = toLocalMeters(polygon[i][0], polygon[i][1], oLat, oLng);
    const [xj, yj] = toLocalMeters(polygon[j][0], polygon[j][1], oLat, oLng);
    const cross = xj * yi - xi * yj;
    area += cross;
    cx += (xj + xi) * cross;
    cy += (yj + yi) * cross;
  }

  area /= 2;
  if (area === 0) {
    const lat = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
    const lng = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
    return [lat, lng];
  }

  cx /= 6 * area;
  cy /= 6 * area;

  // Convert the local offset back to lat/lng.
  const lat = oLat + (cy / EARTH_RADIUS_M) * (180 / Math.PI);
  const lng =
    oLng + (cx / (EARTH_RADIUS_M * Math.cos(toRad(oLat)))) * (180 / Math.PI);
  return [lat, lng];
}

/** Do two line segments properly cross? */
function segmentsIntersect(p1, p2, p3, p4) {
  const orient = (a, b, c) => {
    const v = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
    return v === 0 ? 0 : v > 0 ? 1 : 2;
  };

  const o1 = orient(p1, p2, p3);
  const o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1);
  const o4 = orient(p3, p4, p2);

  return o1 !== o2 && o3 !== o4;
}

/**
 * Does the ring cross itself? A bow-tie shape breaks point-in-polygon in ways
 * that are almost impossible to debug from a complaint landing in the wrong
 * zone, so it is rejected at save time.
 */
export function polygonSelfIntersects(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 4) return false;

  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i];
    const a2 = polygon[(i + 1) % n];

    for (let j = i + 1; j < n; j++) {
      // Skip segments that share a vertex - they touch by definition.
      if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;

      const b1 = polygon[j];
      const b2 = polygon[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** Pull a ring slightly towards its own centroid. */
function shrinkPolygon(polygon, factor) {
  const c = polygonCentroid(polygon);
  if (!c) return polygon;
  return polygon.map(([lat, lng]) => [
    c[0] + (lat - c[0]) * factor,
    c[1] + (lng - c[1]) * factor,
  ]);
}

/**
 * Do two rings overlap in AREA?
 *
 * The distinction that matters: zones computed from anchor points tessellate,
 * so neighbours legitimately SHARE a border. A naive test - "is any vertex of
 * one inside the other, or do any edges cross" - calls that an overlap, because
 * a point sitting exactly on a boundary is undefined under ray-casting. That
 * would report every adjacent pair on a perfectly good campus as overlapping.
 *
 * So both rings are pulled a fraction towards their own centroids first.
 * Shared edges come apart; a genuine overlap of area survives.
 */
export function polygonsOverlap(a, b) {
  if (!a?.length || !b?.length) return false;

  const sa = shrinkPolygon(a, 0.999);
  const sb = shrinkPolygon(b, 0.999);

  if (sa.some((p) => pointInPolygon(p[0], p[1], sb))) return true;
  if (sb.some((p) => pointInPolygon(p[0], p[1], sa))) return true;

  // One ring fully containing the other, with no vertex of either inside the
  // shrunken form of the other, is still an overlap.
  const ca = polygonCentroid(sa);
  const cb = polygonCentroid(sb);
  if (ca && pointInPolygon(ca[0], ca[1], sb)) return true;
  if (cb && pointInPolygon(cb[0], cb[1], sa)) return true;

  for (let i = 0; i < sa.length; i++) {
    const a1 = sa[i];
    const a2 = sa[(i + 1) % sa.length];
    for (let j = 0; j < sb.length; j++) {
      const b1 = sb[j];
      const b2 = sb[(j + 1) % sb.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Resolve a GPS fix to a zone.
 *
 * The ladder, in order:
 *
 *   1. inside exactly one polygon   -> that zone                    POLYGON
 *   2. inside several polygons      -> the SMALLEST wins            OVERLAP
 *   3. inside none, near an edge    -> the zone with the nearest    NEAREST_EDGE
 *                                      boundary, flagged
 *   4. far from everything          -> nearest zone, but flagged    OUT_OF_BOUNDS
 *
 * Rule 2 matters for determinism: the same coordinates must always resolve to
 * the same zone or the audit trail stops making sense. Smallest-wins also
 * matches intent - a small shape drawn inside a big one is a carve-out.
 *
 * @returns {{
 *   zone: object, resolvedBy: string, distanceM: number,
 *   matchedPolygon: boolean, outOfBounds: boolean, overlappingZoneCodes: number[]
 * }}
 */
export function detectZone(lat, lng, zones, opts = {}) {
  if (!zones?.length) throw new Error('detectZone: no zones supplied');
  const maxSnapM = opts.maxSnapMeters ?? DEFAULT_MAX_SNAP_METERS;

  const withPolygons = zones.filter((z) => Array.isArray(z.polygon) && z.polygon.length >= 3);

  // Nothing has been drawn yet. There is no honest answer here, so say so
  // rather than assigning the complaint to an arbitrary zone.
  if (
    withPolygons.length === 0 &&
    !zones.some((z) => z.centroidLat != null && z.centroidLng != null)
  ) {
    const err = new Error('No zone boundaries have been set up yet');
    err.code = 'NO_ZONES_CONFIGURED';
    throw err;
  }

  // 1 & 2 - inside one or more polygons.
  const containing = withPolygons.filter((z) => pointInPolygon(lat, lng, z.polygon));

  if (containing.length === 1) {
    return {
      zone: containing[0],
      resolvedBy: 'POLYGON',
      distanceM: 0,
      matchedPolygon: true,
      outOfBounds: false,
      overlappingZoneCodes: [],
    };
  }

  if (containing.length > 1) {
    const bySize = containing
      .map((z) => ({ zone: z, area: polygonAreaM2(z.polygon) }))
      .sort((a, b) => a.area - b.area);

    return {
      zone: bySize[0].zone,
      resolvedBy: 'OVERLAP_SMALLEST',
      distanceM: 0,
      matchedPolygon: true,
      outOfBounds: false,
      overlappingZoneCodes: containing.map((z) => z.code).sort((a, b) => a - b),
    };
  }

  // 3 & 4 - outside everything. Rank by distance to the nearest edge, and fall
  // back to centroid distance for any zone the admin has not drawn yet.
  const ranked = zones
    .map((z) => {
      const hasPolygon = Array.isArray(z.polygon) && z.polygon.length >= 3;
      const distanceM = hasPolygon
        ? distanceToPolygonEdgeMeters(lat, lng, z.polygon)
        : z.centroidLat != null
          ? haversineMeters(lat, lng, z.centroidLat, z.centroidLng)
          : Infinity;
      return { zone: z, distanceM };
    })
    .sort((a, b) => a.distanceM - b.distanceM);

  const nearest = ranked[0];

  return {
    zone: nearest.zone,
    resolvedBy: nearest.distanceM > maxSnapM ? 'OUT_OF_BOUNDS' : 'NEAREST_EDGE',
    distanceM: nearest.distanceM,
    matchedPolygon: false,
    outOfBounds: nearest.distanceM > maxSnapM,
    overlappingZoneCodes: [],
  };
}

/**
 * Order other zones by centroid distance from `originZone`.
 * This is what stops a Zone 2 complaint being handed to a Zone 6 worker while
 * an idle Zone 1 worker stands 200m away.
 */
export function zonesByProximity(originZone, allZones) {
  const hasOrigin = originZone.centroidLat != null && originZone.centroidLng != null;

  return allZones
    .filter((z) => z.id !== originZone.id)
    .map((z) => ({
      zone: z,
      // An undrawn zone has no position, so it sorts last rather than throwing.
      distanceM:
        hasOrigin && z.centroidLat != null && z.centroidLng != null
          ? haversineMeters(
              originZone.centroidLat,
              originZone.centroidLng,
              z.centroidLat,
              z.centroidLng,
            )
          : Infinity,
    }))
    .sort((a, b) => a.distanceM - b.distanceM);
}

/**
 * Offset a lat/lng by a distance in metres. Used by the seed to lay the demo
 * campus out around a single configurable centre point.
 */
export function offsetMeters(lat, lng, northM, eastM) {
  const dLat = (northM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = (eastM / (EARTH_RADIUS_M * Math.cos(toRad(lat)))) * (180 / Math.PI);
  return [lat + dLat, lng + dLng];
}

/**
 * Build zone boundaries from a centre pin - and optionally a size - per zone.
 *
 * This is the practical way to set up a campus: the admin marks a point inside
 * each zone (or stands there and uses their own GPS) and, if they want, a
 * second point saying how far that zone reaches. Every location on campus is
 * then assigned to exactly one zone. No gaps, no overlaps, by construction.
 *
 * WITHOUT radii this is an ordinary Voronoi diagram: nearest centre wins.
 *
 * WITH radii it becomes a power diagram, which is the part worth understanding.
 * The naive reading of "centre + boundary pin" is that the zone IS that circle
 * - but circles overlap where they cross and leave gaps in between, which is
 * the exact problem this design exists to avoid. So the radius is treated as
 * how much territory the zone CLAIMS, not as a literal edge: a zone with a
 * 300m radius outranks one with 100m, and the border between them sits closer
 * to the smaller zone. The test becomes
 *
 *     |p - centre|^2 - radius^2
 *
 * and whichever zone scores lowest owns the point. That stays linear, so the
 * borders are still straight lines and the same clipping works.
 *
 * One caveat the caller must handle: if a zone's radius is very small next to
 * its neighbours, its cell can be squeezed out of existence. `emptyCells`
 * reports any zone that lost its territory that way.
 *
 * @param {Array<{code:number, lat:number, lng:number, radiusM?:number}>} anchors
 * @param {{marginM?:number}} [opts] padding around the anchors' bounding box
 * @returns {Array<{code:number, polygon:Array<[number,number]>, empty:boolean,
 *                  containsAnchor:boolean}>}
 */
export function voronoiCells(anchors, opts = {}) {
  const valid = anchors.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng));
  if (valid.length === 0) return [];

  const marginM = opts.marginM ?? 400;

  // Work in local metres so the bisector maths is plain planar geometry.
  const originLat = valid.reduce((s, a) => s + a.lat, 0) / valid.length;
  const originLng = valid.reduce((s, a) => s + a.lng, 0) / valid.length;

  const sites = valid.map((a) => {
    const [x, y] = toLocalMeters(a.lat, a.lng, originLat, originLng);
    return {
      code: a.code,
      x,
      y,
      // No radius means "no preference" - the plain nearest-centre rule.
      r: Number.isFinite(a.radiusM) && a.radiusM > 0 ? a.radiusM : 0,
      lat: a.lat,
      lng: a.lng,
    };
  });

  // A single anchor owns the whole campus.
  if (sites.length === 1) {
    const m = Math.max(marginM, sites[0].r);
    return [
      {
        code: sites[0].code,
        polygon: [
          [sites[0].x - m, sites[0].y + m],
          [sites[0].x + m, sites[0].y + m],
          [sites[0].x + m, sites[0].y - m],
          [sites[0].x - m, sites[0].y - m],
        ].map(([x, y]) => localToLatLng(x, y, originLat, originLng)),
        empty: false,
        containsAnchor: true,
      },
    ];
  }

  const minX = Math.min(...sites.map((s) => s.x)) - marginM;
  const maxX = Math.max(...sites.map((s) => s.x)) + marginM;
  const minY = Math.min(...sites.map((s) => s.y)) - marginM;
  const maxY = Math.max(...sites.map((s) => s.y)) + marginM;

  const rect = [
    [minX, maxY],
    [maxX, maxY],
    [maxX, minY],
    [minX, minY],
  ];

  return sites.map((self) => {
    let cell = rect;

    for (const other of sites) {
      if (other.code === self.code) continue;
      cell = clipToNearer(cell, self, other);
      if (cell.length === 0) break;
    }

    const polygon = cell.map(([x, y]) => localToLatLng(x, y, originLat, originLng));

    return {
      code: self.code,
      polygon,
      // A zone whose radius is tiny next to its neighbours can be squeezed
      // out entirely. The caller needs to tell the admin rather than silently
      // saving a zone with no territory.
      empty: polygon.length < 3,
      containsAnchor:
        polygon.length >= 3 ? pointInPolygon(self.lat, self.lng, polygon) : false,
    };
  });
}

/** Convert local metres back to [lat, lng]. */
function localToLatLng(x, y, originLat, originLng) {
  const lat = originLat + (y / EARTH_RADIUS_M) * (180 / Math.PI);
  const lng =
    originLng + (x / (EARTH_RADIUS_M * Math.cos(toRad(originLat)))) * (180 / Math.PI);
  return [lat, lng];
}

/**
 * Sutherland-Hodgman clip: keep the part of `polygon` that belongs to `self`
 * rather than `other`.
 *
 * Without radii the dividing line is the perpendicular bisector. With radii it
 * is the radical axis - still a straight line, just shifted towards whichever
 * zone claims less territory. Both cases fall out of the same comparison:
 *
 *     |P - self|^2 - self.r^2   <=   |P - other|^2 - other.r^2
 */
function clipToNearer(polygon, self, other) {
  if (polygon.length === 0) return polygon;

  const dx = other.x - self.x;
  const dy = other.y - self.y;
  const c =
    self.x * self.x + self.y * self.y - self.r * self.r -
    (other.x * other.x + other.y * other.y - other.r * other.r);
  const f = ([x, y]) => 2 * (x * dx + y * dy) + c;

  const out = [];

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const fa = f(a);
    const fb = f(b);

    const aIn = fa <= 0;
    const bIn = fb <= 0;

    if (aIn) out.push(a);

    // The edge crosses the bisector - add the crossing point.
    if (aIn !== bIn) {
      const t = fa / (fa - fb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }

  return out;
}

/**
 * Sample a grid across the campus and report which fraction of it resolves
 * cleanly into a zone. Powers the admin's coverage preview - it turns an
 * invisible data problem (a gap nobody owns) into something you can see.
 */
export function coverageReport(zones, opts = {}) {
  const drawn = zones.filter((z) => Array.isArray(z.polygon) && z.polygon.length >= 3);
  if (!drawn.length) {
    return { samples: 0, covered: 0, coveragePct: 0, gaps: [], overlaps: [], bounds: null };
  }

  const lats = drawn.flatMap((z) => z.polygon.map((p) => p[0]));
  const lngs = drawn.flatMap((z) => z.polygon.map((p) => p[1]));
  const bounds = {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };

  const steps = Math.min(Math.max(opts.steps ?? 40, 10), 80);
  const gaps = [];
  let samples = 0;
  let covered = 0;

  // Sample the CENTRE of each grid cell, not its corners. A point sitting
  // exactly on a boundary belongs to neither polygon under ray-casting, so
  // sampling the bounding box edges would report phantom gaps all around the
  // perimeter. Cell centres are also the correct way to estimate area.
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const lat = bounds.minLat + ((bounds.maxLat - bounds.minLat) * (i + 0.5)) / steps;
      const lng = bounds.minLng + ((bounds.maxLng - bounds.minLng) * (j + 0.5)) / steps;
      samples++;

      if (drawn.some((z) => pointInPolygon(lat, lng, z.polygon))) covered++;
      else if (gaps.length < 400) gaps.push([lat, lng]);
    }
  }

  // Every pair of zones that overlaps - the admin needs the specific pairs,
  // not just a count.
  const overlaps = [];
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      if (polygonsOverlap(drawn[i].polygon, drawn[j].polygon)) {
        overlaps.push([drawn[i].code, drawn[j].code]);
      }
    }
  }

  return {
    samples,
    covered,
    coveragePct: samples ? Math.round((covered / samples) * 100) : 0,
    gaps,
    overlaps,
    bounds,
  };
}
