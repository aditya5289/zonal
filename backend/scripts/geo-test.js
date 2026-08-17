/**
 * Unit tests for the zone geometry.
 *
 * No database and no server needed - this is pure maths, and it decides which
 * officer receives every complaint, so it is worth testing on its own.
 *
 *   node scripts/geo-test.js
 */

import {
  pointInPolygon,
  distanceToPolygonEdgeMeters,
  polygonAreaM2,
  polygonCentroid,
  polygonSelfIntersects,
  polygonsOverlap,
  detectZone,
  coverageReport,
  offsetMeters,
  haversineMeters,
  voronoiCells,
} from '../src/utils/geo.js';

/** offsetMeters returns [lat, lng]; anchors want named fields. */
const pt = ([lat, lng]) => ({ lat, lng });

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(`${name}: ${detail}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

// A square roughly 200m x 200m, near the demo campus centre.
const O_LAT = 26.8467;
const O_LNG = 80.9462;

function square(centreLat, centreLng, sizeM) {
  const h = sizeM / 2;
  return [
    offsetMeters(centreLat, centreLng, h, -h),
    offsetMeters(centreLat, centreLng, h, h),
    offsetMeters(centreLat, centreLng, -h, h),
    offsetMeters(centreLat, centreLng, -h, -h),
  ];
}

console.log('\nZone geometry tests\n');

// ---------------------------------------------------------------------------
console.log('Point in polygon');
const sq = square(O_LAT, O_LNG, 200);
check('centre is inside', pointInPolygon(O_LAT, O_LNG, sq));
check(
  'a point well outside is outside',
  !pointInPolygon(...offsetMeters(O_LAT, O_LNG, 500, 0), sq),
);
check('a ring with 2 points is never inside', !pointInPolygon(O_LAT, O_LNG, [[0, 0], [1, 1]]));

// ---------------------------------------------------------------------------
console.log('\nArea and centroid');
const area = polygonAreaM2(sq);
check('200m square is ~40,000 m2', near(area, 40000, 500), `${Math.round(area)} m2`);

const [cLat, cLng] = polygonCentroid(sq);
check(
  'centroid of a square is its centre',
  haversineMeters(cLat, cLng, O_LAT, O_LNG) < 1,
  `${haversineMeters(cLat, cLng, O_LAT, O_LNG).toFixed(2)} m off`,
);

// ---------------------------------------------------------------------------
console.log('\nDistance to the boundary');
// 50m north of the square's centre is still inside; distance to the edge is 50m.
const [inLat, inLng] = offsetMeters(O_LAT, O_LNG, 50, 0);
check(
  'inside, 50m from the north edge',
  near(distanceToPolygonEdgeMeters(inLat, inLng, sq), 50, 2),
  `${distanceToPolygonEdgeMeters(inLat, inLng, sq).toFixed(1)} m`,
);

// 130m north of centre is 30m outside the edge (edge is at 100m).
const [outLat, outLng] = offsetMeters(O_LAT, O_LNG, 130, 0);
check(
  'outside, 30m past the north edge',
  near(distanceToPolygonEdgeMeters(outLat, outLng, sq), 30, 2),
  `${distanceToPolygonEdgeMeters(outLat, outLng, sq).toFixed(1)} m`,
);

// ---------------------------------------------------------------------------
console.log('\nValidation');
check('a clean square does not self-intersect', !polygonSelfIntersects(sq));

const bowtie = [
  offsetMeters(O_LAT, O_LNG, 100, -100),
  offsetMeters(O_LAT, O_LNG, -100, 100),
  offsetMeters(O_LAT, O_LNG, 100, 100),
  offsetMeters(O_LAT, O_LNG, -100, -100),
];
check('a bow-tie is caught as self-intersecting', polygonSelfIntersects(bowtie));

const far = square(...offsetMeters(O_LAT, O_LNG, 0, 400), 200);
check('two separated squares do not overlap', !polygonsOverlap(sq, far));

const shifted = square(...offsetMeters(O_LAT, O_LNG, 0, 100), 200);
check('two squares sharing area do overlap', polygonsOverlap(sq, shifted));

const contained = square(O_LAT, O_LNG, 50);
check('a square fully inside another overlaps', polygonsOverlap(sq, contained));

// ---------------------------------------------------------------------------
console.log('\nThe resolution ladder');

const zoneA = { id: 'a', code: 1, name: 'Zone 1', polygon: sq, centroidLat: O_LAT, centroidLng: O_LNG };
const bCentre = offsetMeters(O_LAT, O_LNG, 0, 400);
const zoneB = {
  id: 'b',
  code: 2,
  name: 'Zone 2',
  polygon: square(...bCentre, 200),
  centroidLat: bCentre[0],
  centroidLng: bCentre[1],
};

// 1. Cleanly inside one polygon.
const r1 = detectZone(O_LAT, O_LNG, [zoneA, zoneB]);
check('inside one polygon resolves to it', r1.zone.code === 1 && r1.resolvedBy === 'POLYGON');
check('a clean hit reports distance 0', r1.distanceM === 0);

// 2. Inside two overlapping polygons - the smaller must win, deterministically.
const small = {
  id: 's',
  code: 3,
  name: 'Zone 3',
  polygon: square(O_LAT, O_LNG, 60),
  centroidLat: O_LAT,
  centroidLng: O_LNG,
};
const r2 = detectZone(O_LAT, O_LNG, [zoneA, small]);
check(
  'overlapping polygons: the smallest wins',
  r2.zone.code === 3 && r2.resolvedBy === 'OVERLAP_SMALLEST',
  `picked Zone ${r2.zone.code}`,
);
check(
  'the overlap is reported to the admin',
  r2.overlappingZoneCodes.join(',') === '1,3',
  r2.overlappingZoneCodes.join(','),
);
const r2b = detectZone(O_LAT, O_LNG, [small, zoneA]);
check(
  'overlap resolution does not depend on zone order',
  r2b.zone.code === r2.zone.code,
);

// 3. In the gap between two zones - nearest EDGE wins, not nearest centre.
const gap = offsetMeters(O_LAT, O_LNG, 0, 150); // 50m past A's edge, 150m from B's
const r3 = detectZone(gap[0], gap[1], [zoneA, zoneB]);
check(
  'a point in the gap goes to the nearest edge',
  r3.zone.code === 1 && r3.resolvedBy === 'NEAREST_EDGE',
  `Zone ${r3.zone.code}, ${r3.distanceM.toFixed(0)} m`,
);
check('the gap case is flagged, not silently accepted', r3.matchedPolygon === false);

// The case nearest-centroid gets wrong: a long corridor whose centre is far
// away but whose edge is close.
const corridor = {
  id: 'c',
  code: 4,
  name: 'Zone 4',
  // 1000m long, 40m wide, running east from the origin.
  polygon: [
    offsetMeters(O_LAT, O_LNG, 20, 0),
    offsetMeters(O_LAT, O_LNG, 20, 1000),
    offsetMeters(O_LAT, O_LNG, -20, 1000),
    offsetMeters(O_LAT, O_LNG, -20, 0),
  ],
  centroidLat: offsetMeters(O_LAT, O_LNG, 0, 500)[0],
  centroidLng: offsetMeters(O_LAT, O_LNG, 0, 500)[1],
};
const blob = {
  id: 'd',
  code: 5,
  name: 'Zone 5',
  polygon: square(...offsetMeters(O_LAT, O_LNG, 200, 0), 100),
  centroidLat: offsetMeters(O_LAT, O_LNG, 200, 0)[0],
  centroidLng: offsetMeters(O_LAT, O_LNG, 200, 0)[1],
};
// A point 30m north of the corridor: 10m from the corridor's edge, but its
// centroid is 500m east. Zone 5's centroid is only 170m away.
const nearCorridor = offsetMeters(O_LAT, O_LNG, 30, 0);
const r4 = detectZone(nearCorridor[0], nearCorridor[1], [corridor, blob]);
check(
  'nearest EDGE beats nearest centre for a long thin zone',
  r4.zone.code === 4,
  `picked Zone ${r4.zone.code} at ${r4.distanceM.toFixed(0)} m`,
);

// 4. Miles away - flagged as off-campus rather than silently assigned.
const wayOut = offsetMeters(O_LAT, O_LNG, 5000, 0);
const r5 = detectZone(wayOut[0], wayOut[1], [zoneA, zoneB]);
check(
  'a far-away point is flagged out of bounds',
  r5.resolvedBy === 'OUT_OF_BOUNDS' && r5.outOfBounds === true,
  `${(r5.distanceM / 1000).toFixed(1)} km away`,
);
check('but a zone is still suggested rather than nothing', r5.zone != null);

// ---------------------------------------------------------------------------
console.log('\nCoverage report');
const cov = coverageReport([zoneA, zoneB], { steps: 30 });
check('coverage finds gaps between separated zones', cov.coveragePct < 100, `${cov.coveragePct}%`);
check('gap samples are returned for display', cov.gaps.length > 0, `${cov.gaps.length} points`);
check('no overlaps reported for separated zones', cov.overlaps.length === 0);

const covOverlap = coverageReport([zoneA, small], { steps: 20 });
check(
  'overlapping zones are reported as a pair',
  covOverlap.overlaps.length === 1 && covOverlap.overlaps[0].join(',') === '1,3',
  JSON.stringify(covOverlap.overlaps),
);

// ---------------------------------------------------------------------------
console.log('\nBoundaries from anchor pins');

// Four anchors in a square - the classic case.
const anchors = [
  { code: 1, ...pt(offsetMeters(O_LAT, O_LNG, 200, -200)) },
  { code: 2, ...pt(offsetMeters(O_LAT, O_LNG, 200, 200)) },
  { code: 3, ...pt(offsetMeters(O_LAT, O_LNG, -200, 200)) },
  { code: 4, ...pt(offsetMeters(O_LAT, O_LNG, -200, -200)) },
];

const cells = voronoiCells(anchors, { marginM: 300 });
check('one cell per anchor', cells.length === 4, `${cells.length} cells`);
check(
  'every cell is a usable polygon',
  cells.every((c) => c.polygon.length >= 3),
  cells.map((c) => c.polygon.length).join(','),
);

// The defining property: each anchor must land inside its OWN cell.
const ownCell = cells.every((c) => {
  const a = anchors.find((x) => x.code === c.code);
  return pointInPolygon(a.lat, a.lng, c.polygon);
});
check('each anchor sits inside its own cell', ownCell);

// No overlaps, by construction.
let anyOverlap = false;
for (let i = 0; i < cells.length; i++) {
  for (let j = i + 1; j < cells.length; j++) {
    // Shared edges touch but must not overlap in area; test with points well
    // inside each cell rather than on the boundary.
    const centreI = polygonCentroid(cells[i].polygon);
    if (pointInPolygon(centreI[0], centreI[1], cells[j].polygon)) anyOverlap = true;
  }
}
check('cells do not overlap', !anyOverlap);

// No gaps: every sample inside the campus box lands in exactly one cell.
const zonesFromAnchors = cells.map((c) => ({
  id: `z${c.code}`,
  code: c.code,
  name: `Zone ${c.code}`,
  polygon: c.polygon,
}));
const anchorCoverage = coverageReport(zonesFromAnchors, { steps: 30 });
check(
  'the partition covers the whole campus with no gaps',
  anchorCoverage.coveragePct === 100,
  `${anchorCoverage.coveragePct}%`,
);

// A point clearly nearest anchor 1 must resolve to zone 1.
const near1 = offsetMeters(O_LAT, O_LNG, 260, -260);
const res1 = detectZone(near1[0], near1[1], zonesFromAnchors);
check(
  'a point nearest anchor 1 resolves to Zone 1',
  res1.zone.code === 1 && res1.resolvedBy === 'POLYGON',
  `got Zone ${res1.zone.code} via ${res1.resolvedBy}`,
);

// Dead centre is equidistant from all four - it must still resolve, cleanly.
const centre = detectZone(O_LAT, O_LNG, zonesFromAnchors);
check(
  'the exact midpoint still resolves to a single zone',
  centre.zone != null && centre.matchedPolygon === true,
  `Zone ${centre.zone?.code}`,
);

const single = voronoiCells([{ code: 1, lat: O_LAT, lng: O_LNG }], { marginM: 300 });
check('a single anchor owns the whole campus', single.length === 1 && single[0].polygon.length === 4);

check('no anchors yields no cells', voronoiCells([]).length === 0);

// ---------------------------------------------------------------------------
console.log('\nZone size from a centre + boundary pin');

// Two anchors 400m apart. Equal claim -> the border sits halfway.
const twoEqual = voronoiCells(
  [
    { code: 1, ...pt(offsetMeters(O_LAT, O_LNG, 0, -200)), radiusM: 150 },
    { code: 2, ...pt(offsetMeters(O_LAT, O_LNG, 0, 200)), radiusM: 150 },
  ],
  { marginM: 300 },
);
const areaEqual1 = polygonAreaM2(twoEqual.find((c) => c.code === 1).polygon);
const areaEqual2 = polygonAreaM2(twoEqual.find((c) => c.code === 2).polygon);
check(
  'equal radii split the campus evenly',
  near(areaEqual1, areaEqual2, areaEqual1 * 0.02),
  `${Math.round(areaEqual1)} vs ${Math.round(areaEqual2)} m2`,
);

// Same positions, but zone 1 claims far more territory.
const twoUneven = voronoiCells(
  [
    { code: 1, ...pt(offsetMeters(O_LAT, O_LNG, 0, -200)), radiusM: 300 },
    { code: 2, ...pt(offsetMeters(O_LAT, O_LNG, 0, 200)), radiusM: 100 },
  ],
  { marginM: 300 },
);
const bigArea = polygonAreaM2(twoUneven.find((c) => c.code === 1).polygon);
const smallArea = polygonAreaM2(twoUneven.find((c) => c.code === 2).polygon);
check(
  'a bigger radius claims more ground',
  bigArea > smallArea,
  `${Math.round(bigArea)} vs ${Math.round(smallArea)} m2`,
);
check(
  'the smaller zone keeps its own centre',
  twoUneven.find((c) => c.code === 2).containsAnchor,
);

// The whole point: sizing zones must NOT reintroduce gaps or overlaps.
const sizedZones = twoUneven.map((c) => ({
  id: `z${c.code}`,
  code: c.code,
  name: `Zone ${c.code}`,
  polygon: c.polygon,
}));
const sizedCoverage = coverageReport(sizedZones, { steps: 30 });
check(
  'sized zones still cover the campus with no gaps',
  sizedCoverage.coveragePct === 100,
  `${sizedCoverage.coveragePct}%`,
);
check('sized zones do not overlap', sizedCoverage.overlaps.length === 0);

// An extreme mismatch can squeeze a zone out entirely - that must be reported,
// not silently saved as a zone with no territory.
const squeezed = voronoiCells(
  [
    { code: 1, ...pt(offsetMeters(O_LAT, O_LNG, 0, -50)), radiusM: 2000 },
    { code: 2, ...pt(offsetMeters(O_LAT, O_LNG, 0, 50)), radiusM: 1 },
  ],
  { marginM: 200 },
);
const squeezedCell = squeezed.find((c) => c.code === 2);
check(
  'a zone squeezed out of existence is flagged',
  squeezedCell.empty || !squeezedCell.containsAnchor,
  `empty=${squeezedCell.empty} containsAnchor=${squeezedCell.containsAnchor}`,
);

// No radii at all must behave exactly as before.
const noRadii = voronoiCells(
  [
    { code: 1, ...pt(offsetMeters(O_LAT, O_LNG, 0, -200)) },
    { code: 2, ...pt(offsetMeters(O_LAT, O_LNG, 0, 200)) },
  ],
  { marginM: 300 },
);
check(
  'omitting radii falls back to plain nearest-centre',
  near(
    polygonAreaM2(noRadii[0].polygon),
    polygonAreaM2(noRadii[1].polygon),
    polygonAreaM2(noRadii[0].polygon) * 0.02,
  ),
);

// ---------------------------------------------------------------------------
console.log(`\n${'-'.repeat(58)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
console.log(`${'-'.repeat(58)}\n`);
process.exit(failed > 0 ? 1 : 0);
