const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require('@discordjs/voice');
const axios = require('axios');
const { PassThrough } = require('stream');
const plex = require('./plex');
const logger = require('./utils/logger');
const { saveState, clearGuildState } = require('./persistence');
const { resolveAnnounceChannel } = require('./announce');
const db = require('./database');

// How many tracks back to remember for anti-duplicate checks
const RECENT_TRACK_MEMORY = parseInt(process.env.ANTI_DUPLICATE_MEMORY || '10');

class GuildQueue {
  constructor(guildId, voiceConnection, textChannel, client) {
    this.guildId = guildId;
    this.connection = voiceConnection;
    this.textChannel = textChannel;
    this.client = client;
    this.tracks = [];
    this.currentTrack = null;
    this.volume = parseFloat(process.env.DEFAULT_VOLUME || '0.5');
    this.loop = false;
    this.loopQueue = false;
    this.playing = false;
    this.recentlyPlayed = []; // anti-duplicate: stores track keys of last N played

    this.player = createAudioPlayer();


    // Wait for connection to be Ready before subscribing
    if (this.connection.state.status === VoiceConnectionStatus.Ready) {
      this.connection.subscribe(this.player);
      logger.info('Voice connection already ready, subscribed immediately');
    } else {
      this.connection.once(VoiceConnectionStatus.Ready, () => {
        this.connection.subscribe(this.player);
        logger.info('Voice connection ready, subscribed player for guild ' + guildId);
      });
    }

    this.player.on(AudioPlayerStatus.Idle, () => {
      // Clean up temp file from previous track
      if (this._tmpFile) {
        require('fs').unlink(this._tmpFile, () => {});
        this._tmpFile = null;
      }
      if (this.loop && this.currentTrack) {
        this.playTrack(this.currentTrack);
      } else {
        if (this.loopQueue && this.currentTrack) {
          this.tracks.push(this.currentTrack);
        }
        this.playNext();
      }
    });

    this.player.on('error', err => {
      logger.error('Player error in guild ' + this.guildId + ':', err);
      this.playNext();
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        this.destroy();
      }
    });
  }

  async playTrack(track) {
    try {
      const streamUrl = await plex.getTrackStreamUrl(track.key);
      let resource;

      if (plex.authMethod === 'path') {
        resource = createAudioResource(streamUrl, {
          inputType: StreamType.Arbitrary,
          inlineVolume: true,
        });
      } else {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const { spawn } = require('child_process');

        // Detect source format from URL
        const ext = streamUrl.includes('.flac') ? '.flac' :
                    streamUrl.includes('.mp3') ? '.mp3' :
                    streamUrl.includes('.m4a') ? '.m4a' : '.audio';
        const tmpSrc  = path.join(os.tmpdir(), 'zyntra-src-' + Date.now() + ext);
        const tmpOpus = path.join(os.tmpdir(), 'zyntra-' + Date.now() + '.opus');

        // Step 1: Download the full file from Plex
        await new Promise((resolve, reject) => {
          const urlObj = new URL(streamUrl);
          const httpModule = urlObj.protocol === 'https:' ? require('https') : require('http');
          const fileStream = fs.createWriteStream(tmpSrc);
          const req = httpModule.get(streamUrl, {
            headers: {
              'Accept': '*/*',
              'Accept-Encoding': 'identity',
              'X-Plex-Client-Identifier': 'zyntra-discord-bot',
              'X-Plex-Product': 'Zyntra',
            }
          }, (res) => {
            if (res.statusCode !== 200 && res.statusCode !== 206) {
              reject(new Error('Plex returned ' + res.statusCode + ' for stream'));
              return;
            }
            res.pipe(fileStream);
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
          });
          req.on('error', (err) => {
            logger.error('Download error: ' + err.message);
            reject(err);
          });
        });

        // Step 2: Transcode to Opus using ffmpeg
        // Opus is Discord's native format — this eliminates all real-time decode pressure
        await new Promise((resolve, reject) => {
          const ff = spawn('ffmpeg', [
            '-i', tmpSrc,
            '-c:a', 'libopus',   // encode to Opus
            '-b:a', '128k',      // 128kbps — good quality, small file
            '-vbr', 'on',        // variable bitrate for efficiency
            '-ar', '48000',      // Discord requires 48kHz
            '-ac', '2',          // stereo
            '-f', 'opus',
            '-y',                // overwrite if exists
            tmpOpus,
          ]);
          ff.on('close', (code) => {
            fs.unlink(tmpSrc, () => {}); // clean up source file immediately
            if (code === 0) resolve();
            else reject(new Error('ffmpeg transcode failed with code ' + code));
          });
          ff.on('error', reject);
        });

        // Store transcoded file path for cleanup after playback
        this._tmpFile = tmpOpus;

        resource = createAudioResource(tmpOpus, {
          inputType: StreamType.OggOpus,  // tell @discordjs/voice it's already Opus
          inlineVolume: true,
        });
      }

      resource.volume?.setVolume(this.volume);
      this.player.play(resource);
      this.currentTrack = track;
      this.playing = true;
      this.resource = resource;

      // Record play to history database
      if (track.requestedBy) {
        db.recordPlay({
          guildId: this.guildId,
          userId: track.requestedBy.id,
          username: track.requestedBy.username,
          track,
        });
      }

      // Track recently played for anti-duplicate
      this.recentlyPlayed.push(track.key);
      if (this.recentlyPlayed.length > RECENT_TRACK_MEMORY) {
        this.recentlyPlayed.shift();
      }

      saveState(this.client);
      this.client?.presenceManager?.refresh();

      // Post now-playing: prefer dedicated announce channel, fall back to command channel
      const announceChannel = this.client
        ? await resolveAnnounceChannel(this.client, this.guildId)
        : null;
      const target = announceChannel || this.textChannel;
      if (target) {
        target.send({ embeds: [this._nowPlayingEmbed(track)] })
          .then(msg => msg.react('👍').catch(() => {}))
          .catch(e => logger.error('Now playing send failed (check bot permissions in channel ' + target.id + '):', e.message));
      }
    } catch (err) {
      logger.error('Error playing track:', err);
      if (this.textChannel) {
        this.textChannel.send('Error playing **' + track.title + '**. Skipping...').catch(() => {});
      }
      this.playNext();
    }
  }

  async playNext() {
    if (this.tracks.length === 0) {
      this.currentTrack = null;
      this.playing = false;
      clearGuildState(this.guildId);
      this.client?.presenceManager?.refresh();
      const announceChannel = this.client
        ? await resolveAnnounceChannel(this.client, this.guildId)
        : null;
      const doneTarget = announceChannel || this.textChannel;
      if (doneTarget) {
        doneTarget.send({
          embeds: [{
            color: 0x5865f2,
            description: '✅ Queue finished! Add more tracks with `/play` or `!play`.',
          }],
        }).catch(() => {});
      }
      return;
    }

    // Wait for voice connection to be Ready before playing
    if (this.connection.state.status !== VoiceConnectionStatus.Ready) {
      logger.info('Waiting for voice connection to be ready...');
      try {
        await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);
        logger.info('Voice connection ready, starting playback');
      } catch {
        logger.error('Voice connection failed to become ready, skipping track');
        this.tracks.shift(); // remove the track we were about to play
        return;
      }
    }

    const next = this.tracks.shift();
    await this.playTrack(next);
  }

  // Returns { added: true } or { added: false, reason: string }
  addTrack(track, force = false) {
    if (!force && this._isDuplicate(track)) {
      return { added: false, reason: '**' + track.title + '** was recently played. Use `/forceplay` to add it anyway.' };
    }
    if (!force && this.tracks.some(t => t.key === track.key)) {
      return { added: false, reason: '**' + track.title + '** is already in the queue.' };
    }
    this.tracks.push(track);
    saveState(this.client);
    return { added: true };
  }

  // Returns count of tracks actually added
  addTracks(tracks, force = false) {
    let added = 0;
    for (const track of tracks) {
      const inQueue = this.tracks.some(t => t.key === track.key);
      const recent = !force && this._isDuplicate(track);
      if (!inQueue && !recent) {
        this.tracks.push(track);
        added++;
      }
    }
    if (added > 0) saveState(this.client);
    return added;
  }

  _isDuplicate(track) {
    if (process.env.ANTI_DUPLICATE === 'false') return false;
    return this.recentlyPlayed.includes(track.key);
  }

  skip() {
    this.player.stop();
  }

  pause() {
    this.player.pause();
    this.playing = false;
    saveState(this.client);
    this.client?.presenceManager?.refresh();
  }

  resume() {
    this.player.unpause();
    this.playing = true;
    this.client?.presenceManager?.refresh();
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.resource?.volume) this.resource.volume.setVolume(this.volume);
    saveState(this.client);
  }

  shuffle() {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
    saveState(this.client);
  }

  clear() {
    this.tracks = [];
    saveState(this.client);
  }

  destroy() {
    if (this._tmpFile) { require('fs').unlink(this._tmpFile, () => {}); this._tmpFile = null; }
    this.player.stop();
    this.connection.destroy();
    this.playing = false;
    this.currentTrack = null;
    clearGuildState(this.guildId);
    this.client?.presenceManager?.refresh();
  }

  getStatus() {
    return {
      playing: this.playing,
      currentTrack: this.currentTrack,
      queue: this.tracks,
      volume: this.volume,
      loop: this.loop,
      loopQueue: this.loopQueue,
      playerStatus: this.player.state.status,
    };
  }

  _nowPlayingEmbed(track) {
    const duration = track.duration
      ? Math.floor(track.duration / 60) + ':' + String(track.duration % 60).padStart(2, '0')
      : 'Unknown';
    return {
      color: 0xe5a00d,
      title: 'Now Playing',
      description: '**' + track.title + '**',
      fields: [
        { name: 'Artist', value: track.artist, inline: true },
        { name: 'Album', value: track.album, inline: true },
        { name: 'Duration', value: duration, inline: true },
      ],
      thumbnail: track.thumb ? { url: plex.getAuthenticatedThumbUrl(track.thumb) } : undefined,
      footer: { text: '👍 React to vote into the community playlist  •  Queue: ' + this.tracks.length + ' track(s) remaining' },
    };
  }
}

module.exports = { GuildQueue };
