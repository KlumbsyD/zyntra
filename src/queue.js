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
    this.connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => {
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
        const response = await axios.get(streamUrl, { responseType: 'stream' });
        const passthrough = new PassThrough();
        response.data.pipe(passthrough);
        resource = createAudioResource(passthrough, {
          inputType: StreamType.Arbitrary,
          inlineVolume: true,
        });
      }

      resource.volume?.setVolume(this.volume);
      this.player.play(resource);
      this.currentTrack = track;
      this.playing = true;
      this.resource = resource;

      // Track recently played for anti-duplicate
      this.recentlyPlayed.push(track.key);
      if (this.recentlyPlayed.length > RECENT_TRACK_MEMORY) {
        this.recentlyPlayed.shift();
      }

      saveState(this.client);
      this.client?.presence?.refresh();

      // Post now-playing: prefer dedicated announce channel, fall back to command channel
      const announceChannel = this.client
        ? await resolveAnnounceChannel(this.client, this.guildId)
        : null;
      const target = announceChannel || this.textChannel;
      if (target) target.send({ embeds: [this._nowPlayingEmbed(track)] }).catch(() => {});
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
      this.client?.presence?.refresh();
      // Notify in announce channel or fallback text channel
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
    // player.stop() triggers AudioPlayerStatus.Idle which calls playNext(),
    // which will call saveState once the next track is known.
    this.player.stop();
  }

  pause() {
    this.player.pause();
    this.playing = false;
    saveState(this.client);
    this.client?.presence?.refresh();
  }

  resume() {
    this.player.unpause();
    this.playing = true;
    this.client?.presence?.refresh();
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
    this.player.stop();
    this.connection.destroy();
    this.playing = false;
    this.currentTrack = null;
    clearGuildState(this.guildId);
    this.client?.presence?.refresh();
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
      footer: { text: 'Queue: ' + this.tracks.length + ' track(s) remaining' },
    };
  }
}

module.exports = { GuildQueue };
