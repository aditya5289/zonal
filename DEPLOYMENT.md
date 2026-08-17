# Deploying to the MMMUT server

Everything needed to put the Smart Clean Campus API on a university-run Linux
server, safely.

**Assumptions.** Ubuntu 22.04 or Debian 12, root or sudo, a subdomain such as
`clean.mmmut.ac.in` pointed at the server, and ports 80/443 reachable. If any
of those differ — especially if the server is behind the university firewall
with no public DNS — read [Variations](#variations) first, because several
steps change.

---

## What changed to make this production-safe

The demo build was not safe to expose. Five things were fixed:

| Problem | Why it mattered | Fix |
|---|---|---|
| JWT secret had a working default | Anyone reading the source could forge an admin session | Server **refuses to start** in production without a strong secret |
| CORS allowed every origin | Any website could call the API with a user's browser session | Allowlist, and production refuses to start with an empty one |
| No rate limiting | Login was brute-forceable | 20 auth attempts / 15 min, 300 requests / min, plus nginx-level shedding |
| No security headers | Clickjacking, MIME sniffing, referrer leaks | `helmet` |
| **Uploads were world-readable** | Complaint photos show named people at a known place and time. Anyone with a URL could read them forever | `/uploads` now requires a valid token |

That last one is the one to mention if anyone asks what changed for
deployment. It was a genuine privacy hole, not a theoretical one.

---

## 1. Prepare the server

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx postgresql postgresql-contrib ufw
```

Node 22 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version    # expect v22.x
```

Firewall — SSH and web only. Postgres stays on localhost and must never be
exposed:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

A dedicated unprivileged user, so a compromise of the app is not a compromise
of the machine:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin zonal
sudo mkdir -p /opt/zonal /var/lib/zonal/uploads
sudo chown -R zonal:zonal /opt/zonal /var/lib/zonal
```

---

## 2. Database

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE zonal;
CREATE USER zonal WITH ENCRYPTED PASSWORD 'PUT_A_STRONG_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON DATABASE zonal TO zonal;
\c zonal
GRANT ALL ON SCHEMA public TO zonal;
\q
```

The application user owns exactly one database and is **not** a superuser. If
the app is ever exploited, the blast radius stops at this data.

Confirm it is not listening publicly:

```bash
sudo ss -tlnp | grep 5432     # expect 127.0.0.1:5432 only
```

---

## 3. Deploy the code

```bash
sudo -u zonal git clone <your-repo-url> /opt/zonal
cd /opt/zonal/backend
sudo -u zonal npm ci --omit=dev
sudo -u zonal npx prisma generate
```

> `npm ci` not `npm install` — it installs exactly the locked versions rather
> than resolving fresh ones, so the server runs what you tested.

### Configure

```bash
sudo -u zonal cp .env.production.example .env
sudo -u zonal nano .env
```

Generate the secret first and paste it in:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Fill in `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_URL`, `CORS_ORIGINS`, and set
`UPLOAD_DIR=/var/lib/zonal/uploads`. Then lock the file down — it holds the
keys to every account:

```bash
sudo chmod 600 /opt/zonal/backend/.env
sudo chown zonal:zonal /opt/zonal/backend/.env
```

### Migrate and seed

```bash
cd /opt/zonal/backend
sudo -u zonal npx prisma migrate deploy

sudo -u zonal ADMIN_EMAIL=admin@mmmut.ac.in ADMIN_PASSWORD='a-long-unique-password' \
  node prisma/seed-production.js
```

`migrate deploy` applies existing migrations without ever generating or
resetting — the only migration command safe to run against real data.

The production seed creates **only** the 8 zones (undrawn), the campus
landmarks, and one admin. No demo users, no shared password. It warns you if
any `@campus.edu` demo accounts are present.

---

## 4. Run it as a service

```bash
sudo cp /opt/zonal/deploy/zonal-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zonal-api
sudo systemctl status zonal-api
```

```bash
curl -s http://127.0.0.1:4000/api/health
# {"status":"ok","db":"up",...}
```

If it will not start, the reason is in the log and is usually a config guard
doing its job:

```bash
sudo journalctl -u zonal-api -n 50 --no-pager
```

---

## 5. nginx and HTTPS

```bash
sudo cp /opt/zonal/deploy/nginx-zonal.conf /etc/nginx/sites-available/zonal
sudo nano /etc/nginx/sites-available/zonal      # set your real hostname
sudo ln -s /etc/nginx/sites-available/zonal /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Certificate:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d clean.mmmut.ac.in
sudo systemctl status certbot.timer      # auto-renewal
```

Verify from **another machine**, not the server:

```bash
curl -s https://clean.mmmut.ac.in/api/health
```

---

## 6. Backups

The photos matter as much as the database. A complaint without its evidence
cannot be verified, and no migration can regenerate them.

```bash
sudo cp /opt/zonal/deploy/backup-zonal.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/backup-zonal.sh
sudo /usr/local/bin/backup-zonal.sh          # run once by hand first
sudo crontab -e
```

```cron
15 2 * * *  /usr/local/bin/backup-zonal.sh >> /var/log/zonal-backup.log 2>&1
```

**A backup nobody has restored is a guess.** Test it once a term:

```bash
sudo -u postgres createdb zonal_restore_test
sudo -u postgres pg_restore -d zonal_restore_test /var/backups/zonal/zonal-db-*.dump
sudo -u postgres dropdb zonal_restore_test
```

Copy backups off the machine as well — a disk failure takes the backups with
the database otherwise.

---

## 7. Build the app against the server

On your PC, once HTTPS works:

```powershell
cd mobile
flutter build apk --release --dart-define=API_BASE_URL=https://clean.mmmut.ac.in
```

`--release`, not `--debug`: smaller, faster, and not shipping a debug runtime.

**Before building, remove the cleartext-HTTP permission.** It exists only so
the phone could reach a local dev server over plain HTTP. Leaving it in a
production build permits silent downgrade attacks:

In `mobile/android/app/src/main/AndroidManifest.xml`, delete:

```xml
android:usesCleartextTraffic="true"
```

The APK is at `build/app/outputs/flutter-apk/app-release.apk`.

> A release APK must be signed with your own key to be updatable later.
> Flutter signs with a debug key unless configured — fine for sideloading,
> **not** fine for the Play Store. Set up signing before any public release.

---

## 8. First run in the app

1. Sign in as the admin you seeded
2. **Set up zones** — draw the real MMMUT boundaries, or drop one pin per zone
   and let them be computed. Nothing works until this is done: complaints are
   refused with a clear message while the campus is unmapped
3. Create the 8 zone officers and assign one to each zone
4. Workers self-register; verify them as they arrive

---

## Day-to-day

```bash
sudo systemctl restart zonal-api          # restart
sudo journalctl -u zonal-api -f           # live logs
sudo journalctl -u zonal-api --since today | grep -i error
```

Deploying an update:

```bash
cd /opt/zonal
sudo -u zonal git pull
cd backend
sudo -u zonal npm ci --omit=dev
sudo -u zonal npx prisma migrate deploy
sudo -u zonal npx prisma generate
sudo systemctl restart zonal-api
curl -s http://127.0.0.1:4000/api/health
```

Take a backup before any deploy that includes a migration.

---

## Variations

**No public DNS / internal only.** Skip certbot. Use the university's internal
CA, or run HTTP on the campus network and set `PUBLIC_URL` to the internal
address. Do **not** run without TLS if the app is reachable from outside —
tokens and photos would cross the network in clear text.

**Postgres already exists on the server.** Skip the install, create just the
database and user, and point `DATABASE_URL` at it.

**Docker preferred.** `docker-compose.yml` runs Postgres already; a production
compose file would need the app container, a volume for
`/var/lib/zonal/uploads`, and nginx still in front for TLS. systemd is simpler
here and one less moving part for university admins to learn.

**Shared hosting / cPanel only.** This needs a long-running Node process and
will not work on PHP-style shared hosting. A small VPS is the fallback.

---

## Before you call it live

- [ ] `curl https://.../api/health` works from off the server
- [ ] No `@campus.edu` demo accounts (`seed-production.js` warns)
- [ ] `.env` is `chmod 600`, `JWT_SECRET` freshly generated
- [ ] Postgres bound to 127.0.0.1 only
- [ ] `ufw status` shows only SSH and Nginx
- [ ] Backup script run once by hand and restore tested
- [ ] `usesCleartextTraffic` removed from the Android manifest
- [ ] Zones drawn, officers assigned
- [ ] Admin password stored somewhere sensible and not shared

---

## Honest limitations

Things this deployment does **not** yet have. None block a pilot; all matter
at scale:

- **No password reset.** A user who forgets theirs needs an admin to recreate
  the account. The most likely first support request.
- **Uploads are on local disk.** Fine for one server; means no horizontal
  scaling and one disk to lose.
- **No email or SMS.** Notifications are in-app only, so nobody hears about a
  complaint unless they open the app.
- **No audit log for admin actions.** Complaint transitions are fully logged;
  admin edits to zones, officers and landmarks are not.
- **One admin account.** No delegation, no second pair of eyes.
- **Load is untested.** It has run against tens of complaints, not thousands.
  The insight queries scan the full window in memory and will want indexing
  or caching well before that becomes a problem.
