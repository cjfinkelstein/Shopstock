# Getting APEX Electrical Stock onto everyone's phones

The app installs straight from the browser — no App Store needed. The one thing
it needs first is a small cloud server (~$6/month) so the crew can reach it from
any job site. Total setup is about an hour.

## Step 1 — Rent a server (10 min)

Any of these works; pick whichever feels easiest:

- **Hetzner** (cheapest, ~€4.50/mo): hetzner.com → Cloud → CX22, Ubuntu 24.04
- **DigitalOcean** ($6/mo): digitalocean.com → Droplet → Basic, Ubuntu 24.04

Choose a datacenter near you, add your email/SSH key, create it, and note the
server's **IP address**.

## Step 2 — Install Docker on it (5 min)

Connect to the server (`ssh root@YOUR-IP` — or use the provider's web console)
and run:

```bash
curl -fsSL https://get.docker.com | sh
```

## Step 3 — Copy the project up and configure it (10 min)

From this PC, copy the whole `Cj test` folder to the server — easiest on
Windows is [WinSCP](https://winscp.net) (drag the folder to `/opt/shopstock`),
or in PowerShell:

```bash
scp -r "C:\Users\joshy\Documents\Cj test" root@YOUR-IP:/opt/shopstock
```

On the server, create the settings file:

```bash
cd /opt/shopstock
cp .env.example .env
nano .env
```

Set these four lines (make up your own values):

```
JWT_SECRET=<paste something long and random>
POSTGRES_PASSWORD=<another random one>
ADMIN_EMAIL=you@yourcompany.com
ADMIN_PASSWORD=<a real password>
```

## Step 4 — Start it (5 min)

```bash
docker compose up -d --build
docker compose exec api python scripts/seed.py --minimal
```

`--minimal` creates your admin login, the Shop, and Ed / Ray / Avigdor /
Sam / Shui / Al / CJ with Trucks 1–7 — **no demo data**. The app is now
live at `http://YOUR-IP`.

## Step 5 — Give it a real address with HTTPS (15 min, recommended)

HTTPS is what lets Android phones install it like a real app (iPhones can pin
it either way). You need a domain (~$10/yr, e.g. Namecheap):

1. At your domain registrar, add an **A record**: `shop.yourdomain.com → YOUR-IP`.
2. On the server, edit `docker-compose.yml`: change the web service's ports
   line from `"80:80"` to `"127.0.0.1:8080:80"`, then `docker compose up -d`.
3. Run Caddy — it fetches the HTTPS certificate automatically:

```bash
docker run -d --name caddy --restart unless-stopped --network host \
  -v caddy_data:/data caddy \
  caddy reverse-proxy --from shop.yourdomain.com --to localhost:8080
```

Done: the app lives at `https://shop.yourdomain.com`.

## Step 6 — Load your real inventory (30 min, one time)

Sign in as admin → **Items** → add your materials (SKU, name, category, unit,
reorder point). Then **Receive** your opening quantities with real costs so
the ledger starts true. Create your active **Jobs**.

> Shortcut: if you have a price list or spreadsheet of your materials, give it
> to Claude — it can bulk-load the whole catalog for you.

## Step 7 — Get it on the crew's phones (2 min each)

Send everyone the address, then:

- **iPhone**: open it in Safari → Share → **Add to Home Screen**
- **Android**: open it in Chrome → tap the **Install** prompt

It gets its own icon and opens full-screen like any other app. Each tech taps
their name to clock in — that's the whole login.

## Ongoing

- **Backups**: nightly database dump — see "Backups" in README.md (one cron
  line; copy the dumps somewhere off the server now and then).
- **Updates**: copy the changed project up and `docker compose up -d --build`.
- **New tech or truck**: Settings → add tech / add truck, assign, done.
