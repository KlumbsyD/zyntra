# 🎵 Zyntra

A Docker container that streams music from your **Plex Media Server** into Discord voice channels. Designed for UnRAID but runs anywhere Docker does.

---

## ✨ Features

| Feature | Details |
|---|---|
| **Slash Commands** | 22 commands — playback, queue, stats, admin, and more |
| **Text Commands** | Most commands with `!` prefix (e.g. `!play`, `!skip`) |
| **Web Dashboard** | Real-time queue view, playback controls, Plex search at `http://your-ip:3333` |
| **Queue Management** | Add tracks, view/shuffle queue, loop track or queue, anti-duplicate protection |
| **Smart Search** | Searches by track title first, falls back to artist name automatically |
| **Search Scoring** | Penalises live/remix/acoustic versions unless explicitly searched |
| **Playlists & Albums** | Queue full Plex playlists or albums by name |
| **Community Playlist** | Users vote tracks in via 👍 reactions — each server gets its own Plex playlist |
| **Lidarr Integration** | When an artist is not in Plex, automatically request them in Lidarr |
| **DJ Role** | Restrict playback controls to a specific Discord role |
| **Announce Channel** | Dedicated channel for now-playing notifications |
| **Listening Stats** | Per-user and server-wide stats with `/stats` |
| **Zyntra Wrapped** | Spotify Wrapped-style year-in-review with `/wrapped` |
| **Music Personalities** | 8 personality types based on your listening habits |
| **Resume on Restart** | Queue and playback state survive container restarts |
| **Dynamic Presence** | Bot status updates in real time with the current track |
| **Timezone Support** | Wrapped stats use your configured local timezone |
| **Multi-Server Ready** | Commands register automatically per server — no configuration needed |

---

## 🚀 Quick Start on UnRAID

### Step 1 — Create a Discord Bot

#### 1.1 Create the application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and sign in with your Discord account
2. Click **New Application** in the top right
3. Name it **Zyntra** and click **Create**
4. On the **General Information** page, copy the **Application ID** — this is your `DISCORD_CLIENT_ID`

#### 1.2 Create the bot user

1. Click **Bot** in the left sidebar
2. Click **Add Bot** → **Yes, do it!**
3. Under the bot's username, click **Reset Token** → **Yes, do it!**
4. Copy the token — this is your `DISCORD_TOKEN`. **Save it somewhere safe — you can only see it once**
5. Scroll down to **Privileged Gateway Intents** and enable all three:
   - **Presence Intent**
   - **Server Members Intent**
   - **Message Content Intent**
6. Click **Save Changes**

> **Why are these intents needed?**
> - **Message Content Intent** — lets Zyntra read message content for text commands (e.g. `!play`)
> - **Server Members Intent** — needed to count unique users for the community playlist reaction feature
> - **Presence Intent** — allows Zyntra to update its Discord status with the current track

#### 1.3 Set bot permissions

1. Still on the **Bot** page, scroll to **Bot Permissions**
2. Enable the following permissions:
   - `Connect` — join voice channels
   - `Speak` — play audio in voice channels
   - `Send Messages` — post now-playing embeds
   - `Read Message History` — needed to fetch reactions on older messages
   - `Add Reactions` — optional, for future features
   - `Use Slash Commands` — register and use slash commands

#### 1.4 Generate the invite URL

1. Click **OAuth2** in the left sidebar, then **URL Generator**
2. Under **Scopes**, check `bot` and `applications.commands`
3. Under **Bot Permissions**, check the same permissions from step 1.3
4. Set **Integration Type** to **Guild Install**
5. Copy the generated URL at the bottom — open it in your browser to invite Zyntra to your server

#### 1.5 Find your Server ID (Guild ID)

1. In Discord, go to **Settings → Advanced** and enable **Developer Mode**
2. Right-click your server name in the left sidebar
3. Click **Copy Server ID** — you won't need this in `.env` but it's useful for debugging

---

### Step 2 — Get Your Plex Token

1. Sign into Plex Web at `http://your-unraid-ip:32400/web`
2. Open any music track, click the **···** menu → **Get Info** → **View XML**
3. Look at the URL in your browser — copy the value after `?X-Plex-Token=`

Or follow the [Plex Support article](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

> **Note:** Your Plex token is tied to your Plex account session. It does not expire unless you sign out of all devices. Treat it like a password — do not share it or commit it to version control.

---

### Step 3 — Deploy on UnRAID

1. SSH into your UnRAID server
2. Clone this repo:
```bash
git clone https://github.com/klumbsyd/zyntra /mnt/user/appdata/zyntra
cd /mnt/user/appdata/zyntra
```
3. Copy and fill in the env file:
```bash
cp .env.example .env
nano .env
```
4. Build and start:
```bash
docker build -t zyntra:latest .
docker run -d \
  --name zyntra \
  --restart unless-stopped \
  -p 3333:3333 \
  -v /mnt/user/appdata/zyntra/data:/data \
  -v /mnt/user/media/music:/music:ro \
  --env-file /mnt/user/appdata/zyntra/.env \
  zyntra:latest
```

> **Important:** Zyntra must run in **bridge** network mode (the default). Do not use `--network host` — it blocks Discord UDP voice traffic via iptables on UnRAID. See the [Networking section](#-unraid-networking--bridge-vs-host) for a full explanation.

> **Important:** Set `PLEX_URL` to `http://172.17.0.1:32400` (the Docker bridge gateway IP), not your LAN IP. See the [Networking section](#-unraid-networking--bridge-vs-host) for why.

---

## 🔄 Auto-Start on UnRAID Boot

Because Zyntra is deployed via the command line rather than through UnRAID's Docker template UI, the autostart toggle won't appear in the Docker tab. Use a User Script instead:

1. Install the **User Scripts** plugin from the Community Apps store if you don't have it
2. Go to **Settings → User Scripts**
3. Click **Add New Script** and name it `Start Zyntra`
4. Click the gear icon → **Edit Script** and paste:
```bash
#!/bin/bash
docker start zyntra
```
5. Set the schedule to **At Startup of Array**
6. Click **Save**

Zyntra will now start automatically whenever your UnRAID array starts.

> **Rebuilds vs restarts:** A rebuild (`docker build`) is only needed when you change source files or `package.json`. Normal server reboots just restart the existing container in seconds. Your database, queue state, DJ roles, and announce channel settings are all stored in the `/data` volume and survive both restarts and rebuilds.

---

## 🔨 Updating Zyntra

### When to rebuild

A rebuild is required whenever you change any of the following:

| Change | Rebuild needed? |
|---|---|
| Source files (`.js`) | Yes |
| `package.json` or `package-lock.json` | Yes |
| `Dockerfile` | Yes |
| `.env` values | No — just recreate the container |
| UnRAID server reboot | No — container restarts automatically |
| Crash or Docker restart | No — container restarts automatically |

### How to rebuild

```bash
cd /mnt/user/appdata/zyntra

# Pull latest changes from GitHub (if applicable)
git pull

# Rebuild the image
docker build --no-cache -t zyntra:latest .

# Stop and remove the old container
docker stop zyntra && docker rm zyntra

# Start a fresh container with the new image
docker run -d \
  --name zyntra \
  --restart unless-stopped \
  -p 3333:3333 \
  -v /mnt/user/appdata/zyntra/data:/data \
  -v /mnt/user/media/music:/music:ro \
  --env-file /mnt/user/appdata/zyntra/.env \
  zyntra:latest
```

> **Your data is safe.** The `/data` volume (database, queue state, DJ roles, announce channel, community playlist mappings) is stored outside the container and is never affected by a rebuild.

### How to apply .env changes only (no rebuild needed)

If you only changed values in your `.env` file, you do not need to rebuild — just recreate the container:

```bash
docker stop zyntra && docker rm zyntra

docker run -d \
  --name zyntra \
  --restart unless-stopped \
  -p 3333:3333 \
  -v /mnt/user/appdata/zyntra/data:/data \
  -v /mnt/user/media/music:/music:ro \
  --env-file /mnt/user/appdata/zyntra/.env \
  zyntra:latest
```

### Verify the container is running

```bash
docker logs --since 30s zyntra
```

You should see `Logged in as Zyntra` and `Web dashboard running` within a few seconds of starting.

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DISCORD_TOKEN` | *required* | Bot token from the Developer Portal |
| `DISCORD_CLIENT_ID` | *required* | Application ID from General Information |
| `TEXT_PREFIX` | `!` | Prefix for text commands |
| `PLEX_AUTH_METHOD` | `token` | `token` / `oauth` / `path` |
| `PLEX_URL` | `http://localhost:32400` | Plex server URL — use `http://172.17.0.1:32400` on UnRAID bridge |
| `PLEX_TOKEN` | — | Plex auth token (token method) |
| `PLEX_MUSIC_PATH` | `/music` | Music folder path (path method) |
| `DEFAULT_VOLUME` | `0.5` | Default volume (0.0–1.0) |
| `WEB_PORT` | `3333` | Web dashboard port |
| `WEB_PASSWORD` | — | Dashboard password (strongly recommended) |
| `STATE_DIR` | `/data` | Path for queue/role/announce persistence |
| `ANTI_DUPLICATE` | `true` | Block recently played tracks from re-queuing |
| `ANTI_DUPLICATE_MEMORY` | `10` | How many recent tracks to remember |
| `COMMUNITY_PLAYLIST_THRESHOLD` | `3` | Unique 👍 reactions needed to add a track to the community playlist |
| `LIDARR_URL` | — | Lidarr URL (optional, enables auto artist requests) |
| `LIDARR_API_KEY` | — | Lidarr API key (Settings → General) |
| `LIDARR_ROOT_FOLDER` | `/data` | Root folder for new Lidarr artists |
| `TIMEZONE` | `UTC` | IANA timezone for Wrapped stats (e.g. `America/New_York`, `America/Chicago`) |
| `DEBUG` | `false` | Enable verbose logging |

> **Note:** `DISCORD_GUILD_ID` is no longer needed. Zyntra registers slash commands automatically to every server on startup and whenever it joins a new server.

---

## 🎮 Commands

### Playback
| Command | Description |
|---|---|
| `/play <query>` | Search and play a track. Supports `Artist - Title` format. If you search by artist name alone, all their tracks are queued and shuffled. If not found in Plex and Lidarr is configured, requests the artist automatically |
| `/forceplay <query>` | Play a track even if recently played |
| `/search <query>` | Search Plex and list results |
| `/playlist <name>` | Queue a full Plex playlist by name |
| `/playlists` | List all available Plex audio playlists |
| `/album <name>` | Queue a full album |
| `/skip` | Skip the current track |
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/stop` | Stop and clear queue |
| `/disconnect` | Leave the voice channel |

### Queue
| Command | Description |
|---|---|
| `/queue` | Show the current queue |
| `/shuffle` | Shuffle the queue |
| `/loop <track/queue/off>` | Set loop mode |
| `/volume <0-100>` | Set playback volume |
| `/nowplaying` | Show current track info |

### Stats & Wrapped
| Command | Description |
|---|---|
| `/stats me` | Your personal listening stats |
| `/stats user @someone` | View another user's stats |
| `/stats server` | Server-wide leaderboard and top tracks |
| `/stats track <name>` | How many times a track has been played |
| `/wrapped me` | Your Zyntra Wrapped — year in music review |
| `/wrapped user @someone` | View someone else's Wrapped |
| `/wrapped server` | Server Wrapped — top DJs, tracks, and artists |
| `/personalities` | Show how music personalities are determined |

### Admin
| Command | Permission | Description |
|---|---|---|
| `/djrole set @role` | Manage Server | Restrict controls to a DJ role |
| `/djrole clear` | Manage Server | Remove DJ role restriction |
| `/djrole info` | Manage Server | Show current DJ role |
| `/announce set #channel` | Manage Server | Set a dedicated now-playing channel |
| `/announce clear` | Manage Server | Remove announce channel |
| `/announce info` | Manage Server | Show current announce channel |
| `/communityplaylist info` | Manage Server | Show this server's community playlist name |
| `/communityplaylist name <n>` | Manage Server | Rename the community playlist (renames in Plex too, keeps all tracks) |
| `/communityplaylist reset` | Manage Server | Reset the playlist name back to the server default |

### Text Commands (default prefix: `!`)
Most commands work with `!` prefix — e.g. `!play bohemian rhapsody`, `!skip`, `!queue`, `!nowplaying`

---

## 👍 Community Playlist

When a now-playing message receives enough 👍 reactions from unique users, Zyntra automatically adds that track to a Plex playlist named after your Discord server (e.g. **ValhallaNAS Community**).

**How it works:**
- React with 👍 on any now-playing message Zyntra posts
- Once the reaction threshold is hit (default: 3 unique users, set via `COMMUNITY_PLAYLIST_THRESHOLD`), the track is added
- The playlist is created in Plex automatically if it doesn't exist yet
- Duplicate tracks are ignored — a song can only be voted in once
- Zyntra replies in the same channel confirming the addition

**Each Discord server gets its own playlist** — if Zyntra is in multiple servers, each server's votes go to their own separate Plex playlist.

**Commands:**
- `/communityplaylist info` — shows the current playlist name and how to play it
- `/communityplaylist name <new name>` — renames the playlist. The Plex playlist is renamed in place, so all previously voted tracks are preserved
- `/communityplaylist reset` — resets the name back to the default (`<Server Name> Community`), also renames in Plex
- `/playlist <name>` — queue the community playlist like any other Plex playlist

> **Required:** The **Server Members Intent** and **Message Content Intent** must be enabled in the Discord Developer Portal under Bot → Privileged Gateway Intents.

---

## 🎁 Zyntra Wrapped

Run `/wrapped me` at any time to get your personal year-in-review posted as a single Discord embed: total tracks, listening time, unique artists, peak month, favourite hour, top tracks, top artists, and your music personality.

**Music Personalities** (first match wins, checked top to bottom):

| Personality | Condition |
|---|---|
| 🌙 Midnight Loop | Night Owl AND Repeat Offender both true |
| 🦉 Night Shift DJ | Night Owl AND total plays > 200 |
| 🔁 Repeat Offender | Top track accounts for > 20% of all plays |
| 🌙 Night Owl | Peak listening hour between 10pm and 4am |
| 🎭 Genre Hopper | Unique artists divided by total plays > 60% |
| 💿 Album Loyalist | Unique artists divided by total plays < 15% |
| 🎧 Main DJ | Total plays > 200 |
| 🎵 Music Lover | Default — none of the above |

Run `/personalities` to see this chart posted in Discord. Set `TIMEZONE` in your `.env` to get accurate peak hour and month data in your local timezone.

---

## 🎵 Lidarr Integration

When `/play` finds no results in Plex, Zyntra searches Lidarr and adds the artist for download if found. Requires `LIDARR_URL` and `LIDARR_API_KEY`.

- Artists are added with quality profile **Any**, fully monitored, with album search triggered immediately
- If the artist is already in Lidarr, Zyntra reports it rather than adding a duplicate
- Zyntra notifies in the same channel once the request is sent
- If Lidarr is not configured, `/play` simply reports no results as normal

Get your Lidarr API key from **Lidarr → Settings → General**.

---

## 🌐 Web Dashboard

Access at `http://your-unraid-ip:3333` — password protected via `WEB_PASSWORD`.

- Live **Now Playing** with playback controls
- **Volume slider** and **loop toggle**
- **Queue viewer** and **Plex search**
- **Playlist browser**
- Bot and Plex connection status

---

## 🌐 UnRAID Networking — Bridge vs Host

This is the most common source of confusion when running Zyntra on UnRAID, so it is worth explaining clearly.

**Why Zyntra must use Bridge networking:**

Discord voice uses UDP packets on high port numbers (50000–65535). On UnRAID, iptables rules block outbound UDP traffic from containers running in Host network mode. If Zyntra runs as Host, the voice connection connects but never reaches the `ready` state — the bot joins the voice channel but plays no audio.

**Why `PLEX_URL` must use `172.17.0.1` instead of your LAN IP:**

Plex on UnRAID typically runs in Host network mode, bound directly to your server's LAN IP (e.g. `192.168.1.14`). When Zyntra runs in Bridge mode, it gets its own internal Docker IP (e.g. `172.17.0.x`). Plex sees requests from this internal IP as coming from an unknown client and returns HTTP 500 errors.

The fix is to use the Docker bridge gateway IP (`172.17.0.1`). From inside a bridge container, `172.17.0.1` always routes to the host — Plex sees the request as coming from localhost and serves it correctly.

**The correct setup:**

| Container | Network Mode | PLEX_URL setting |
|---|---|---|
| Plex | Host | — |
| Zyntra | Bridge (default) | `http://172.17.0.1:32400` |

```
# In your .env file:
PLEX_URL=http://172.17.0.1:32400
```

Do not use `--network host` for Zyntra and do not use your LAN IP in `PLEX_URL`. Both will cause audio to silently fail.

---

## 🔧 Troubleshooting

**Bot joins voice channel but no audio plays:**
- Ensure Zyntra is running in bridge network mode, not host mode
- Check that `PLEX_URL` is set to `http://172.17.0.1:32400`
- Verify the bot has `Speak` permission in the voice channel

**Slash commands not showing up:**
- Zyntra registers commands automatically to every guild on startup and when it joins a new server — no `DISCORD_GUILD_ID` needed
- If commands are missing, check the logs: `docker logs zyntra | grep "Registered"`
- Make sure the bot was invited with the `applications.commands` scope — re-invite using the OAuth URL if needed

**Plex returns 500 errors:**
- Use `http://172.17.0.1:32400` as `PLEX_URL`, not your LAN IP
- The LAN IP causes 500 errors when accessed from inside a Docker bridge container

**Audio cuts out mid-track:**
- Zyntra downloads the full track before playing to prevent Plex streaming throttle
- Check that `/tmp` inside the container has sufficient free space

**Community playlist reactions not working:**
- Ensure **Server Members Intent** and **Message Content Intent** are enabled in the Discord Developer Portal under Bot → Privileged Gateway Intents
- Reactions must be on a message posted by Zyntra (a now-playing embed)
- Only unique non-bot reactions count toward the threshold

**`/wrapped` or `/stats` shows no data:**
- These rely on SQLite in `/data/zyntra.db` — ensure the `/data` volume is mounted correctly
- Data is only recorded from tracks played after the first run

**Dashboard login not working:**
- Ensure `WEB_PASSWORD` is set in your `.env`
- Clear browser cookies and try again at `http://your-ip:3333/login`
