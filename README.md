# Smart Clean Campus

A zone-based cleanliness management and monitoring system for a university campus.

Residents report unclean areas with geotagged photo, video or audio evidence.
An admin verifies each complaint, the system routes it automatically to the
officer of the zone it came from, that officer allots a worker — or borrows one
from a neighbouring zone when everybody in their own is busy — and the complaint
can only be closed by the person who filed it.

---

## The flow

```
Resident files a complaint
  photo / video / audio  +  compulsory geotag (no GPS fix = no submit)
        │
        ▼
Admin verifies it is genuine ──────────────► REJECTED_INVALID
        │
        ▼
Engine auto-routes it to that ZONE'S OFFICER          ← automatic
        │
        ▼
Officer allots a free worker in their zone
        └─ all busy? ──► asks the nearest zones that DO have someone free
                          └─ another officer lends a worker    (CROSS-ZONE)
                          └─ nobody answers in 30 min ──► Admin
        │
        ▼
Worker: Start → does the job → uploads an AFTER photo → Mark done
        │
        ▼
Satisfaction prompt on the complainer's screen
   ✅ confirm  → CLOSED
   ❌ send back → same worker once, then → Admin
   ⏳ silent 72h → AUTO_CLOSED
```

Four rules stop anything getting stuck:

| Rule | Why it exists |
|---|---|
| One live task per worker | Makes "free" mean something the engine can filter on |
| Rejection cap (1) | Stops a complaint ping-ponging between resident and worker forever |
| Auto-close after 72h | Most people never reopen the app; without this, half of all complaints sit in `WORK_DONE` and the resolution rate is meaningless |
| A timeout on every waiting state | Officer inaction, unanswered help requests and overrun jobs all surface to the admin instead of vanishing |

Auto-closed complaints are counted **separately** from resident-approved ones,
so a timeout can never be presented as someone approving the work.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Flutter (Android + web) | One codebase serves all four roles; the web build is the admin dashboard |
| API | Node.js + Express | — |
| Database | PostgreSQL + Prisma | Zone polygons are plain JSON, so no PostGIS install is needed |
| Maps | OpenStreetMap + flutter_map | No API key and no billing card, unlike Google Maps |
| Auth | JWT + bcrypt | — |

Zone detection is a ray-casting point-in-polygon test over 8 polygons in
[`backend/src/utils/geo.js`](backend/src/utils/geo.js). A fix that lands outside
every zone (the central park, a road, or a poor GPS reading) falls back to the
nearest zone centroid and the resident can correct it.

---

## Emergency reports

A resident can mark a report as an **emergency**. It then behaves differently:

```
Resident submits with the emergency switch on
        │
        │   NO admin verification — the gate is skipped entirely
        ▼
Straight to the zone officer, priority forced to HIGH
        │
        ▼
Broadcast at once to:
   every zone officer          "any officer can send a worker"
   every ON-DUTY worker        "your officer may send you"
   every other resident        "avoid the area until it is cleared"
   the admins                  "reject it if it is not genuine"
```

The trade-offs, chosen deliberately:

| Decision | Why |
|---|---|
| Skips admin verification | Speed beats spam-filtering when something is unsafe |
| Admins still notified | They can reject a fake one *after* the fact |
| **Any** officer can respond, not just the zone's | Whoever has a free worker wins |
| Another zone's officer is offered **their own** workers | They can only send people they actually manage |
| Off-duty workers are not alerted | They cannot act on it, so it would be noise |
| The reporter is not alerted | They already know |
| Residents get a **safety warning**, not a work order | "Avoid the area", not "go clean it" |

Sorted to the top of every officer's queue, and shown with a red border and an
`EMERGENCY` badge throughout the app.

## Before you demo — start in this order

The most common failure is not a bug in the app. It is a layer not running.

```powershell
docker compose up -d                    # 1. Postgres FIRST
cd backend; npm run start               # 2. then the API
adb reverse tcp:4000 tcp:4000           # 3. then the USB tunnel
```

If anything misbehaves, open `http://localhost:4000/api/health` before debugging
anything else. It reports `db: up` or `db: down` and tells you immediately which
layer is broken. A stopped Docker container looks exactly like "the app is not
saving my data".

## Setup

### 1. Database

Postgres runs in Docker, so there is no local install or password to manage:

```powershell
docker compose up -d
```

It binds host port **5433**, not 5432, so it cannot collide with a local
PostgreSQL service. Credentials are already in `backend/.env`.

> Postgres 18+ changed where it keeps its data — the volume must mount at
> `/var/lib/postgresql`, not `/var/lib/postgresql/data`. `docker-compose.yml`
> does this; mounting the old path makes the container refuse to start.

Then:

```powershell
cd backend
npm install
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

The API comes up on `http://localhost:4000`. Check `http://localhost:4000/api/health`.

### 2. Verify the backend

```powershell
cd backend
npm run test:all
```

Three suites, **159 checks**:

| Suite | Checks | What it covers |
|---|---|---|
| `test:geo` | 42 | Zone geometry — nearest-edge resolution, overlap rules, the anchor partition |
| `test:e2e` | 99 | The full API — lifecycle, guards, help handshake, zone admin, analytics |
| `test:emergency` | 18 | The emergency broadcast reaches every role, and skips the ones it should |

This drives the entire lifecycle through the real HTTP API — the worker
approval gate, filing with a compulsory geotag, admin verification,
auto-routing to the zone officer, allotment, the work, proof upload, resident
confirmation, the rejection path, the officer-to-officer help handshake, and
analytics. **73 checks, all passing.**

Run it after any backend change; it is far faster than clicking through the app.

> `test:e2e` reseeds first, on purpose. The suite is not idempotent: the
> cross-zone scenario lends a Zone 1 worker to Zone 2 and leaves that task
> open, so a second run without reseeding exhausts Zone 1's free workers and
> the allotment checks fail. Running `node scripts/smoke-test.js` on its own
> only works against a freshly seeded database.

### 3. App

Install Flutter and Android Studio, open a **new** terminal, then:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-mobile.ps1
```

That generates the platform folders and patches the two things Flutter does not
do for you: the runtime permissions, and permission to reach a plain-HTTP local
server (Android 9+ blocks cleartext by default, and the resulting error is not
obvious).

### 3. Run

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
```

This starts the API, runs `adb reverse tcp:4000 tcp:4000`, and launches the app.

**The tunnel matters.** The phone's `localhost` is the phone, not your PC, so
without `adb reverse` no API call can succeed. Re-run `dev.ps1` after every
unplug. The upside over a hardcoded LAN IP: it survives your WiFi handing you a
different address, and it works on campus networks that isolate clients.

For the admin dashboard in a browser: `scripts\dev.ps1 -Web`.

---

## Demo accounts

Password for every seeded account: **`password123`**

| Role | Email |
|---|---|
| Admin | `admin@campus.edu` |
| Zone officers | `officer1@campus.edu` … `officer8@campus.edu` |
| Worker (approved, Zone 1) | `ramesh.kumar@campus.edu` |
| Worker (awaiting verification) | `salim.ansari@campus.edu` |
| Resident | `aditya@campus.edu` |

Three workers are seeded as `PENDING` on purpose so the admin's verification
screen has something real to act on.

---

## Demo script

Roughly 6 minutes, and it shows every mechanism.

1. **Worker onboarding** — sign in as `salim.ansari@campus.edu`. He is stuck on
   the *Waiting for verification* screen and cannot receive work. Sign in as the
   admin, verify him, refresh his screen: he is now active.

2. **File a complaint** — as `aditya@campus.edu`, tap Report. Point out that
   Submit stays disabled until a GPS fix arrives, and that the zone is detected
   from that fix. Take a photo, submit.

3. **Admin verification** — as the admin, the complaint is in the queue with its
   photo and coordinates. Approve it and note the message: it has been routed to
   the Zone N officer automatically.

4. **Allotment** — sign in as that officer. The engine has already pre-picked
   the least-loaded free worker. Confirm.

5. **The cross-zone handshake — the part worth showing.** Set every worker in
   one zone busy, then file a complaint there. The officer's only option is
   *Ask for help*, and the app lists the nearest zones that actually have
   someone free. Send it. Sign in as one of those officers: the request is in
   their inbox with their own free workers listed, and lending takes one tap.
   The complaint is now flagged cross-zone.

6. **Do the work** — as the worker: Start, then Mark done with an after photo.

7. **Confirmation** — back as the resident, the before and after photos sit side
   by side. Confirm and it closes. Or send it back and watch it return to the
   same worker.

8. **Analytics** — the admin's dashboard: resolution times per stage, which
   zones needed outside help, where complaints cluster on the map.

To demo an escalation without waiting for a real deadline, lower the SLA values
in `backend/.env` and hit `POST /api/admin/jobs/run` as the admin — it fires
every time-based rule immediately.

---

## Design notes

**The zone colours are not the ones from the original poster.** Those failed a
colourblind-safety check: Zone 3 (green) and Zone 4 (pink) came out at ΔE 0.5
under deuteranopia — indistinguishable to roughly 1 in 12 men — and those two
zones share a border on the map. Four of the eight also read as grey.

The replacements pass all six checks, worst adjacent pair ΔE 11.4 under
protanopia. They are assigned in **ring order** (1 → 8 → 7 → 6 → 5 → 4 → 3 → 2
→ 1) because the zones form a ring around the central park, which makes
"adjacent on the map" the same thing as "adjacent in the validated palette".

Three of the hues fall below 3:1 contrast on a white surface, so **a zone is
never identified by colour alone** — the zone name is always drawn with it.

In the charts, colour is assigned by the job it does. "Complaints per zone" is a
magnitude question: the bar length carries the value and the zone name on the
axis carries the identity, so those bars use a single blue ramp rather than
eight hues. Only status uses the reserved status palette, and each of those
ships with an icon and a written label.

---

## Layout

```
backend/
  prisma/schema.prisma      8 models; the state machine lives in the enums
  prisma/seed.js            8 zones, 1 admin, 8 officers, 16 workers, 4 residents
  src/services/workflow.js  every status change goes through transition()
  src/services/allocation.js  routing, worker selection, the help handshake
  src/jobs/scheduler.js     auto-close, SLA escalation, help expiry
  src/routes/               auth · zones · complaints · officer · worker · admin
                            analytics · notifications
mobile/
  lib/core/                 config, models, API client, session, palette, GPS
  lib/shared/               shared widgets + the ZoneGrid
  lib/features/auth         login, register
  lib/features/resident     capture, my complaints, satisfaction
  lib/features/worker       approval gate, duty toggle, task, proof upload
  lib/features/officer      dashboard, allotment, help inbox
  lib/features/admin        verification queues, escalations, analytics, map
scripts/
  setup-mobile.ps1          one-time platform setup
  dev.ps1                   backend + USB tunnel + app
```

## Not built

Stated plainly rather than implied: push notifications (in-app only), SMS and
email, offline capture queueing, duplicate-complaint detection, and a dark
theme. The `SUPER_ADMIN` role from the original proposal is merged into `ADMIN`.
