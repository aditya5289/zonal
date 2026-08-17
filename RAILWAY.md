# Deploying the backend to Railway

Faster than a university VM and needs no sysadmin. Read the warning first —
there is one thing about Railway that will silently destroy data if missed.

---

## Your question: do you need Postgres credentials?

**No.** You add a PostgreSQL service inside your Railway project and Railway
generates the database, the user and the password itself. You never see or type
them.

You connect the two services with a **variable reference**:

```
DATABASE_URL = ${{Postgres.DATABASE_URL}}
```

Railway substitutes the real connection string at deploy time. If the database
is ever recreated, the reference follows it — a hardcoded string would break.

---

## Read this before you deploy

**Railway containers have no permanent disk.** Every deploy, restart or crash
gives you a fresh filesystem. Uploaded complaint photos are written to disk by
this app, so without a volume:

> Every photo, every proof-of-work image, and every worker ID card **is deleted
> on your next deploy.** The complaint rows survive; the evidence does not.

The fix is one step — attach a Volume — and it is step 4 below. Do not skip it.

---

## 1. Push the code to GitHub

Railway deploys from a repository.

```powershell
cd d:\desktop\zonal
git init
git add .
git commit -m "Smart Clean Campus"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/smart-clean-campus.git
git push -u origin main
```

Check that `.env` is **not** in the commit — `backend/.gitignore` already
excludes it, but confirm:

```powershell
git ls-files | Select-String "\.env$"     # should print nothing
```

If it does appear, remove it and rotate anything it contained.

---

## 2. Create the project

1. [railway.app](https://railway.app) → sign in with GitHub
2. **New Project → Deploy from GitHub repo** → pick your repo
3. Railway starts building and **it will fail**. That is expected — it is
   looking at the repository root, which holds both `backend/` and `mobile/`.

Fix it:

**Service → Settings → Source → Root Directory** → `backend`

That makes Railway build only the API and ignore the Flutter app.

---

## 3. Add PostgreSQL

**New → Database → Add PostgreSQL**

That is the entire credential step. Railway creates it and exposes
`DATABASE_URL` on the Postgres service.

---

## 4. Add a Volume — do not skip this

**Service → Settings → Volumes → New Volume**

- Mount path: `/data`

Then, in step 5, set `UPLOAD_DIR=/data/uploads`.

Without this, uploads live on the ephemeral container disk and vanish on the
next deploy. With it, they persist. It costs nothing extra on the starter plan.

---

## 5. Environment variables

**Service → Variables → Raw Editor**, and paste:

```
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=PASTE_A_GENERATED_SECRET_HERE
JWT_EXPIRES_IN=30d
PUBLIC_URL=https://YOUR-APP.up.railway.app
CORS_ORIGINS=https://YOUR-APP.up.railway.app
TRUST_PROXY=1
UPLOAD_DIR=/data/uploads

MAX_PHOTO_MB=10
MAX_VIDEO_MB=25
MAX_AUDIO_MB=5

SLA_OFFICER_ALLOT_HOURS=0.5
SLA_WORKER_COMPLETE_HOURS=24
HELP_REQUEST_EXPIRY_HOURS=0.5
AUTO_CLOSE_HOURS=72
MAX_REOPEN_COUNT=1
MAX_TASKS_PER_WORKER=1
MAX_PIN_ADJUST_METERS=150

RATE_LIMIT_AUTH_MAX=20
RATE_LIMIT_AUTH_WINDOW_MIN=15
RATE_LIMIT_API_MAX=300
RATE_LIMIT_API_WINDOW_MIN=1
RATE_LIMIT_UPLOAD_MAX=20
RATE_LIMIT_UPLOAD_WINDOW_MIN=10

RECURRENCE_WINDOW_DAYS=7
INSIGHT_WINDOW_DAYS=30
INSIGHT_HOTSPOT_MIN_COMPLAINTS=4
INSIGHT_MIN_COMPLAINTS_FOR_STAFFING=15

CAMPUS_CENTER_LAT=26.7314
CAMPUS_CENTER_LNG=83.4324
```

Generate the secret on your PC and paste it in:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> `DATABASE_URL` must be typed exactly as `${{Postgres.DATABASE_URL}}` — that
> is Railway's reference syntax, not a placeholder to replace. If your database
> service is named something other than `Postgres`, use that name.

**The app refuses to start if `JWT_SECRET`, `CORS_ORIGINS` or `PUBLIC_URL` are
missing.** That is deliberate — a misconfigured deploy stops loudly instead of
running insecurely. The reason appears in the deploy logs.

---

## 6. Get your domain

**Service → Settings → Networking → Generate Domain**

You get something like `smart-clean-campus-production.up.railway.app`.

Go back and put that exact URL into `PUBLIC_URL` and `CORS_ORIGINS`, then
redeploy. HTTPS is automatic.

---

## 7. Deploy and check

Railway redeploys on every push to `main`. Watch **Deployments → View Logs**:

```
Smart Clean Campus API
  http://localhost:4000/api/health
Scheduler started (SLA checks every minute)
```

`prisma migrate deploy` runs automatically before the server starts — that is
set in `railway.json`, so your schema is applied on every deploy.

Verify from your machine:

```powershell
curl https://YOUR-APP.up.railway.app/api/health
# {"status":"ok","db":"up",...}
```

---

## 8. Seed the production data

Once, from the Railway shell (**Service → ⋮ → Shell**), or with the CLI:

```bash
ADMIN_EMAIL=admin@mmmut.ac.in ADMIN_PASSWORD='a-long-unique-password' \
  npm run seed:prod
```

This creates the 8 zones (**undrawn**), the 21 campus landmarks, and one admin.
No demo accounts, no shared password.

With the CLI instead:

```powershell
npm i -g @railway/cli
railway login
railway link
railway run --service <your-service> npm run seed:prod
```

---

## 9. Point the app at it

```powershell
cd mobile
flutter build apk --release --dart-define=API_BASE_URL=https://YOUR-APP.up.railway.app
```

**Before building**, remove the cleartext-HTTP permission from
`mobile/android/app/src/main/AndroidManifest.xml`:

```xml
android:usesCleartextTraffic="true"
```

It exists only for local HTTP development. Railway is HTTPS, so it is not
needed — and leaving it in permits a silent downgrade attack.

You can also change the server address inside the app (bottom of the login
screen) without rebuilding, which is useful for testing before you commit to a
release build.

---

## 10. First run

1. Sign in as the admin you seeded
2. **Set up zones** — draw the MMMUT boundaries, or drop one pin per zone
   *(complaints are refused with a clear message until this is done)*
3. Create the 8 zone officers and assign one per zone
4. Workers self-register; verify them as they arrive

---

## Backups — your responsibility

Railway's free tier does **not** back up your database for you.

Take one before anything important:

```powershell
railway run --service Postgres pg_dump -Fc > zonal-backup.dump
```

The Volume holding uploads is not backed up either. For a pilot that is
survivable; before real reliance on it, set a reminder to dump both weekly.

---

## Railway vs the university server

| | Railway | MMMUT VM |
|---|---|---|
| Time to deploy | ~20 minutes | half a day, plus waiting for IT |
| Needs IT approval | no | yes |
| HTTPS | automatic | certbot |
| Cost | free tier, then ~$5/mo | free (university hardware) |
| Data location | third-party cloud, outside India | on campus |
| Survives you graduating | only while someone pays | yes |

**For your demo and pilot: Railway.** It works today and needs nobody's
permission.

**For anything the estate office comes to rely on: the university server.**
Complaint photos may include identifiable people, and a university will
generally want that on its own infrastructure — and the project should outlive
your account. [DEPLOYMENT.md](DEPLOYMENT.md) covers that path.

Nothing is wasted either way: the same code, migrations and seed script run on
both.

---

## When it goes wrong

**Build fails, "Cannot find module"** — Root Directory is not set to `backend`.

**App boots then exits** — read the logs. If it says *"FATAL: this build is not
safe to run in production"*, it is naming the variable you forgot.

**"Can't reach database server"** — `DATABASE_URL` is not the reference
`${{Postgres.DATABASE_URL}}`, or the Postgres service is named differently.

**Photos disappear after a deploy** — no Volume, or `UPLOAD_DIR` is not
`/data/uploads`. The already-lost files cannot be recovered.

**429 errors while testing** — the rate limiter working. Lower the limits are
per-user; wait out the window or raise `RATE_LIMIT_*` temporarily.
