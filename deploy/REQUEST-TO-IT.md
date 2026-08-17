# Hosting request — Smart Clean Campus

*Send this to the MMMUT computer centre / IT department. It tells them exactly
what is needed and, just as importantly, what is **not**.*

---

## What this is

A campus cleanliness reporting system built as a student project. Residents
report unclean areas from a phone with a photo and location; the report is
routed to the officer for that zone, who assigns a cleaning worker; the person
who reported it confirms the work before it closes.

- **Backend:** Node.js 22 + PostgreSQL
- **Frontend:** an Android app (no web hosting needed)
- **Users:** students, faculty, cleaning staff, estate office

## What we need

| | |
|---|---|
| **A Linux VM or server** | Ubuntu 22.04 / Debian 12. 2 vCPU, 4 GB RAM, 40 GB disk is ample |
| **A subdomain** | e.g. `clean.mmmut.ac.in` pointing to that server |
| **Ports 80 and 443** | reachable, so students can use it from mobile data as well as campus WiFi |
| **sudo access** | for the person deploying |
| **Outbound HTTPS** | to install packages and fetch map tiles |

## What we do NOT need

- No Windows Server, no IIS, no cPanel
- No database server of our own — PostgreSQL runs on the same VM
- No public file shares
- No email relay (notifications are in-app only)
- No access to any existing university system or database

## Security

- All traffic over HTTPS. Certificate via Let's Encrypt, or the university's
  own certificate if preferred.
- PostgreSQL bound to `127.0.0.1` only — never exposed to the network.
- The app runs as a dedicated unprivileged user (`zonal`), not root, under
  systemd with filesystem restrictions.
- Firewall (ufw) permits only SSH and HTTPS.
- Rate limiting at both nginx and application level.
- Uploaded photos require authentication to view — they are not public files.
- Nightly backups of the database and uploads, kept 30 days.

## Data held

Names, university email addresses, phone numbers, and photographs of unclean
areas with GPS coordinates. No passwords in plain text (bcrypt), no financial
data, no academic records.

Photographs may incidentally include people. Retention and deletion policy
should be confirmed with the university before opening to all students.

## Two things we need a decision on

**1. Public or internal?**
If the app should work on mobile data (off campus), the server needs public DNS
and a public certificate. If campus-WiFi-only is acceptable, an internal
address is fine and simpler.
*This changes the deployment steps, so we need this answered first.*

**2. Who owns it after handover?**
This is a student project. If the estate office is to keep using it, someone in
IT should hold the admin credentials and know how to restart the service. We
will provide documentation and a walkthrough.

## Contact

*(your name, roll number, department, phone, email)*
*Project supervisor: (name, department)*
