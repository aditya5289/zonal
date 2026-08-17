# Later work

Parked on 11 Aug 2026. Everything below is deferred, not broken — the system
runs end to end on device with 87 API checks and 42 geometry checks passing.

---

## Before the demo

- [ ] **Richer demo seed.** Analytics and the heatmap currently hold ~4
      complaints, so the charts look empty and undersell the work. Generate
      60–80 backdated complaints across all 8 zones, all categories and all
      statuses, with realistic resolution times, so the zone bars, stage
      timings and map have something to show. ~20 min.

- [ ] **Reconcile the poster and the report with what was actually built:**
  - 5 roles on the poster → **4** (SUPER_ADMIN merged into ADMIN)
  - Google Maps API → **OpenStreetMap + flutter_map** (no key, no billing card)
  - Zone colours changed — the poster's pastels failed a colourblind-safety
    check (Zone 3 green vs Zone 4 pink at ΔE 0.5 under deuteranopia, and those
    two zones share a border). Rationale is in `README.md` → Design notes.
  - Zones are now set by the admin from anchor pins, not hardcoded.

- [ ] **Test zone setup on device with real GPS.** Mark the 8 zones around an
      actual location, then file a complaint standing in one and confirm the
      detected zone is right. Untested on real hardware so far.

## Known constraints (deliberate, not bugs)

- **Exactly 8 zones.** The ZoneGrid widget is a fixed 3×3 ring around the
  central park, and `zoneCode` is capped at 1–8 in three zod validators.
  Renaming and re-shaping is supported; adding a 9th zone is not.
- **Admin verifies every complaint.** No auto-approve for trusted residents,
  so the admin is a bottleneck at scale. Fine for a campus, fine for a demo.
- **The smoke test is not idempotent.** The cross-zone scenario lends a Zone 1
  worker to Zone 2 and leaves that task open, so run `npm run test:e2e`
  (which reseeds first) rather than the script alone.

## Not built

Stated plainly rather than implied:

- Push notifications (in-app only)
- SMS and email
- Offline capture queueing
- Duplicate-complaint detection
- Dark theme (the palette was only validated against a light surface)

## Housekeeping

- [ ] `flutter pub outdated` — 19 packages behind, held back by pinned
      constraints. `record` already needed a 5 → 7 major bump to compile.
- [ ] Local Postgres on 5432 is unused; the app runs on the Docker instance on
      **5433**. Remove the local service or leave it — just don't confuse them.
- [ ] Avast HTTPS scanning re-signs every certificate and breaks any tool with
      its own trust store. Fixed for git (`http.sslBackend=schannel`) and
      Gradle (`trustStoreType=WINDOWS-ROOT`). It will bite again with other
      toolchains; turning off Web Shield → HTTPS scanning removes the class.
