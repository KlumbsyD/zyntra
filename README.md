# 🎵 Zyntra

A Docker container that streams music from your **Plex Media Server** into Discord voice channels. Designed for UnRAID but runs anywhere Docker does.

---

## ✨ Features

| Feature | Details |
|---|---|
| **Slash Commands** | `/play`, `/forceplay`, `/search`, `/queue`, `/skip`, `/pause`, `/resume`, `/volume`, `/shuffle`, `/loop`, `/nowplaying`, `/playlist`, `/album`, `/disconnect`, `/djrole`, `/announce`, `/wrapped`, `/stats` |
| **Text Commands** | Most commands with `!` prefix (e.g. `!play`, `!skip`) |
| **Web Dashboard** | Real-time queue view, playback controls, Plex search at `http://your-unraid-ip:3333` |
| **Queue Management** | Add tracks, view/shuffle queue, loop track or queue, anti-duplicate protection |
| **Plex Auth** | Token, OAuth (cloud), or direct file path — pick what works for you |
| **Volume Control** | Per-server volume, adjustable via command or web UI |
| **Search** | Search by track, artist, or album name |
| **Playlists & Albums** | Queue full Plex playlists or albums by name |
| **DJ Role** | Restrict playback controls to a specific Discord role |
| **Announce Channel** | Dedicated channel for now-playing notifications |
| **Listening Stats** | Per-user and server-wide stats with `/stats` |
| **Zyntra Wrapped** | Spotify Wrapped-style year-in-review with `/wrapped` |
| **Resume on Restart** | Queue and playback state survive container restarts |
| **Dynamic Presence** | Bot status updates in real time with the current track |

---

## 🚀 Quick Start on UnRAID

### Step 1 — Create a Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it **Zyntra**
3. Go to **Bot** tab → click **Add Bot**
4. Under **Token** → click **Reset Token** and copy it — this is your `DISCORD_TOKEN`
5. Copy your **Application ID** from the General Information page — this is your `DISCORD_CLIENT_ID`
6. Go to **OAuth2 → URL Generator**:
   - Integration Type: **Guild Install**
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Connect`, `Speak`, `Send Messages`, `Read Message History`, `Use Slash Commands`
7. Open the generated URL and invite the bot to your server
8. Enable **Message Content Intent** under Bot → Privileged Gateway Intents

### Step 2 — Get Your Plex Token (token method)

1. Sign into Plex Web, open any media item, click ··· → **Get Info** → **View XML**
2. The URL will contain `?X-Plex-Token=XXXXXX` — copy that value

Or use the [Plex Support article](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

### Step 3 — Deploy on UnRAID

#### Option A: Build Locally on UnRAID (Recommended)

1. SSH into your UnRAID server
2. Clone this repo: `git clone https://github.com/klumbsyd/zyntra /mnt/user/appdata/zyntra`
3. `cd /mnt/user/appdata/zyntra`
4. Copy the env file: `cp .env.example .env` and fill it in
5. Build the image: `docker build -t zyntra:latest .`
6. Start the container: `docker compose up -d`

#### Option B: Manual Docker via UnRAID UI

Go to **Docker** tab → **Add Container** and fill in:

| Field | Value |
|---|---|
| Name | `zyntra` |
| Repository | `zyntra:latest` |
| Port | `3333:3333` |
| Volume | `/mnt/user/appdata/zyntra/data` → `/data` (rw) |
| Volume | `/mnt/user/media/music` → `/music` (ro) — only needed for path method |

Add these Environment Variables:

```
DISCORD_TOKEN     = your-bot-token
DISCORD_CLIENT_ID = your-client-id
DISCORD_GUILD_ID  = your-server-id
PLEX_AUTH_METHOD  = token
PLEX_URL          = http://192.168.1.100:32400
PLEX_TOKEN        = your-plex-token
WEB_PASSWORD      = your-dashboard-password
STATE_DIR         = /data
WEB_PORT          = 3333
```

---

## 🔐 Plex Auth Methods

Set `PLEX_AUTH_METHOD` to one of:

### `token` (Recommended)
Direct connection to your local Plex server using a static token.
```
PLEX_AUTH_METHOD = token
PLEX_URL         = http://192.168.1.100:32400
PLEX_TOKEN       = your-plex-x-token
```

### `oauth`
Uses Plex cloud OAuth. The bot will log the OAuth URL on startup — open it in a browser to authenticate.
```
PLEX_AUTH_METHOD = oauth
PLEX_URL         = http://192.168.1.100:32400
```

### `path`
No Plex API needed — reads music files directly from a mounted folder.
```
PLEX_AUTH_METHOD = path
PLEX_MUSIC_PATH  = /music
```
Mount your music directory to `/music` in the container.

---

## 🎮 Commands

### Playback
| Command | Description |
|---|---|
| `/play <query>` | Search and play a track |
| `/forceplay <query>` | Play a track even if recently played |
| `/search <query>` | Search Plex and list results |
| `/playlist <name>` | Queue a full Plex playlist |
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
| `/stats me` | Your personal listening stats for this year |
| `/stats user @someone` | View another user's stats |
| `/stats server` | Server-wide leaderboard and top tracks |
| `/stats track <name>` | How many times a track has been played and by whom |
| `/wrapped me` | Your Zyntra Wrapped — 5-slide year in music review |
| `/wrapped user @someone` | View someone else's Wrapped |
| `/wrapped server` | Server Wrapped — top DJs, tracks, and artists |

### Admin
| Command | Permission | Description |
|---|---|---|
| `/djrole set @role` | Manage Server | Restrict controls to a DJ role |
| `/djrole clear` | Manage Server | Remove DJ role restriction |
| `/djrole info` | Manage Server | Show current DJ role |
| `/announce set #channel` | Manage Server | Set a dedicated now-playing channel |
| `/announce clear` | Manage Server | Remove announce channel |
| `/announce info` | Manage Server | Show current announce channel |

### Text Commands (default prefix: `!`)
Most commands work with `!` — e.g. `!play bohemian rhapsody`, `!skip`, `!queue`, `!nowplaying`

---

## 🎁 Zyntra Wrapped

Run `/wrapped me` at any time during the year to get your personal Spotify Wrapped-style review, posted as 5 slides in sequence:

| Slide | Content |
|---|---|
| 1 | Total tracks, listening time, unique artists |
| 2 | 🏆 Your top 5 tracks |
| 3 | 🎤 Your top 5 artists |
| 4 | 📊 Peak month, favourite hour, totals |
| 5 | 🎭 Your music personality label |

**Music Personalities:**
- 🔁 **Repeat Offender** — one track dominates your year
- 🌙 **Night Owl** — peak listening after 10pm
- 🌙 **Midnight Loop** — night owl + repeat offender
- 🦉 **Night Shift DJ** — heavy late-night usage
- 🎭 **Genre Hopper** — wide artist variety
- 💿 **Album Loyalist** — sticks to a few artists
- 🎧 **Main DJ** — 200+ tracks requested
- 🎵 **Music Lover** — here for the vibes

---

## 🌐 Web Dashboard

Access at `http://your-unraid-ip:3333` — password protected via `WEB_PASSWORD`.

- Live **Now Playing** with playback controls
- **Volume slider** and **loop toggle**
- **Queue viewer**
- **Plex search**
- **Playlist browser**
- Bot and Plex connection status indicators

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DISCORD_TOKEN` | *required* | Bot token from Developer Portal |
| `DISCORD_CLIENT_ID` | *required* | Application ID |
| `DISCORD_GUILD_ID` | optional | Guild ID for instant slash command registration |
| `TEXT_PREFIX` | `!` | Prefix for text commands |
| `PLEX_AUTH_METHOD` | `token` | `token` / `oauth` / `path` |
| `PLEX_URL` | `http://localhost:32400` | Plex server URL |
| `PLEX_TOKEN` | — | Plex auth token (token method) |
| `PLEX_MUSIC_PATH` | `/music` | Music folder path (path method) |
| `DEFAULT_VOLUME` | `0.5` | Default volume (0.0–1.0) |
| `WEB_PORT` | `3333` | Web dashboard port |
| `WEB_PASSWORD` | — | Dashboard password (strongly recommended) |
| `STATE_DIR` | `/data` | Path for queue/role/announce persistence |
| `ANTI_DUPLICATE` | `true` | Block recently played tracks from re-queuing |
| `ANTI_DUPLICATE_MEMORY` | `10` | How many recent tracks to remember |
| `DEBUG` | `false` | Enable verbose logging |

---

## 🔧 Troubleshooting

**Bot joins but no audio:**
- Make sure `ffmpeg` is installed in the container (it is, via Alpine package)
- Check that the bot has `Speak` permission in the voice channel

**Slash commands not showing:**
- Set `DISCORD_GUILD_ID` to your server ID for instant registration (global registration takes up to 1 hour)
- After setting it, rebuild and restart the container

**Can't connect to Plex:**
- Ensure `PLEX_URL` uses your UnRAID server's LAN IP (e.g. `192.168.1.100`), not `localhost` — the container has its own network namespace
- Verify your Plex token is correct

**`path` method finds no files:**
- Check the volume mount: `/mnt/user/media/music:/music:ro`
- Files must end in `.mp3`, `.flac`, `.ogg`, `.m4a`, `.wav`, or `.aac`

**`/wrapped` or `/stats` shows no data:**
- These commands rely on the SQLite database in `/data/zyntra.db`
- Make sure your `/data` volume is mounted correctly
- Data is only recorded from tracks played after the database was first created

**Dashboard login not working:**
- Check that `WEB_PASSWORD` is set in your environment variables
- Clear your browser's localStorage and try again
