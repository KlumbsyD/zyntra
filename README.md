# 🎵 Zyntra

A Docker container that streams music from your **Plex Media Server** into Discord voice channels. Designed for UnRAID but runs anywhere Docker does.

---

## ✨ Features

| Feature | Details |
|---|---|
| **Slash Commands** | `/play`, `/search`, `/queue`, `/skip`, `/pause`, `/resume`, `/volume`, `/shuffle`, `/loop`, `/nowplaying`, `/playlist`, `/album`, `/disconnect` |
| **Text Commands** | Same commands with `!` prefix (e.g. `!play`, `!skip`) |
| **Web Dashboard** | Real-time queue view, playback controls, Plex search at `http://your-unraid-ip:3333` |
| **Queue Management** | Add tracks, view/shuffle queue, loop track or queue |
| **Plex Auth** | Token, OAuth (cloud), or direct file path — pick what works for you |
| **Volume Control** | Per-server volume, adjustable via command or web UI |
| **Search** | Search by track, artist, or album name |
| **Playlists** | Play Plex audio playlists by name |
| **Albums** | Queue full albums with `/album <name>` |

---

## 🚀 Quick Start on UnRAID

### Step 1 — Create a Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it anything
3. Go to **Bot** tab → click **Add Bot**
4. Under **Token** → click **Reset Token** and copy it — this is your `DISCORD_TOKEN`
5. Copy your **Application ID** from the General Information page — this is your `DISCORD_CLIENT_ID`
6. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Connect`, `Speak`, `Send Messages`, `Read Message History`, `Use Slash Commands`
7. Open the generated URL and invite the bot to your server
8. Enable **Message Content Intent** under Bot → Privileged Gateway Intents

### Step 2 — Get Your Plex Token (token method)

1. Sign into Plex Web, open any media item, click ···  → **Get Info** → **View XML**
2. The URL will contain `?X-Plex-Token=XXXXXX` — copy that value

Or use the [Plex Support article](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

### Step 3 — Deploy on UnRAID

#### Option A: Manual Docker (Community Apps not yet listed)

Go to **Docker** tab → **Add Container** and fill in:

| Field | Value |
|---|---|
| Repository | `ghcr.io/klumbsyd/zyntra:latest` |
| Port | `3333:3333` |
| Path | `/mnt/user/media/music` → `/music` (ro) — only needed for path method |

Add these Environment Variables:

```
DISCORD_TOKEN          = your-bot-token
DISCORD_CLIENT_ID      = your-client-id
DISCORD_GUILD_ID       = your-server-id  (optional, speeds up slash command registration)
PLEX_AUTH_METHOD       = token
PLEX_URL               = http://192.168.1.100:32400
PLEX_TOKEN             = your-plex-token
```

#### Option B: Build Locally on UnRAID

1. SSH into your UnRAID server
2. Clone this repo: `git clone https://github.com/klumbsyd/zyntra /mnt/user/appdata/zyntra`
3. `cd /mnt/user/appdata/zyntra`
4. Copy the env file: `cp .env.example .env` and fill it in
5. Build and run: `docker compose up -d`

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
Uses Plex cloud OAuth. The bot will log the OAuth URL on startup — open it in a browser to authenticate. Good if you want to avoid hardcoding a token.
```
PLEX_AUTH_METHOD = oauth
PLEX_URL         = http://192.168.1.100:32400
```
*(Token will be obtained via interactive auth on first run)*

### `path`
No Plex API needed — reads music files directly from a mounted folder. Less metadata but works without any Plex credentials.
```
PLEX_AUTH_METHOD = path
PLEX_MUSIC_PATH  = /music
```
Mount your music directory to `/music` in the container.

---

## 🎮 Commands

### Slash Commands
| Command | Description |
|---|---|
| `/play <query>` | Search and play a track |
| `/search <query>` | Search and list results |
| `/queue` | Show the current queue |
| `/skip` | Skip current track |
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/stop` | Stop and clear queue |
| `/volume <0-100>` | Set volume |
| `/shuffle` | Shuffle the queue |
| `/loop <track/queue/off>` | Set loop mode |
| `/nowplaying` | Show current track info |
| `/playlist <name>` | Play a Plex playlist |
| `/album <name>` | Play a full album |
| `/disconnect` | Leave voice channel |

### Text Commands (default prefix: `!`)
Same commands — e.g. `!play bohemian rhapsody`, `!skip`, `!queue`

---

## 🌐 Web Dashboard

Access at `http://your-unraid-ip:3333`

- Live **Now Playing** with controls
- **Volume slider** and **loop toggle**
- **Queue viewer** 
- **Plex search** 
- **Playlist browser**
- Status indicators for bot and Plex connection

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DISCORD_TOKEN` | *required* | Bot token from Developer Portal |
| `DISCORD_CLIENT_ID` | *required* | Application ID |
| `DISCORD_GUILD_ID` | optional | Guild ID for instant slash command reg |
| `TEXT_PREFIX` | `!` | Prefix for text commands |
| `PLEX_AUTH_METHOD` | `token` | `token` / `oauth` / `path` |
| `PLEX_URL` | `http://localhost:32400` | Plex server URL |
| `PLEX_TOKEN` | — | Plex auth token (token method) |
| `PLEX_MUSIC_PATH` | `/music` | Music folder path (path method) |
| `DEFAULT_VOLUME` | `0.5` | Default volume (0.0–1.0) |
| `WEB_PORT` | `3333` | Web dashboard port |
| `DEBUG` | `false` | Enable verbose logging |

---

## 🔧 Troubleshooting

**Bot joins but no audio:**
- Make sure `ffmpeg` is installed in the container (it is, via Alpine package)
- Check that the bot has `Speak` permission in the voice channel

**Slash commands not showing:**
- Set `DISCORD_GUILD_ID` to your server ID for instant registration (global registration takes up to 1 hour)

**Can't connect to Plex:**
- Ensure `PLEX_URL` is the LAN IP of your UnRAID server, not `localhost` (the container has its own network)
- Verify the Plex token is correct

**`path` method finds no files:**
- Check the volume mount in Docker: `/mnt/user/media/music:/music:ro`
- Make sure your files end in `.mp3`, `.flac`, `.ogg`, `.m4a`, `.wav`, or `.aac`
