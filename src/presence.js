const { ActivityType } = require('discord.js');
const logger = require('./utils/logger');

class PresenceManager {
  constructor(client) {
    this.client = client;
    this._pollInterval = null;
  }

  /**
   * Call once on bot ready to start the presence polling loop.
   * Polls every 15s to keep the status fresh (Discord can drift).
   */
  start() {
    this._update();
    this._pollInterval = setInterval(() => this._update(), 15_000);
    logger.info('Presence manager started.');
  }

  stop() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  /** Call this immediately whenever playback state changes. */
  refresh() {
    this._update();
  }

  _update() {
    try {
      const activeQueues = [...this.client.queue.values()].filter(q => q.playing && q.currentTrack);

      if (activeQueues.length === 0) {
        // Nothing playing — show idle status
        this.client.user.setPresence({
          status: 'idle',
          activities: [{
            name: 'Waiting for a song...',
            type: ActivityType.Custom,
            state: '🎵 Zyntra | Ready to play',
          }],
        });
        return;
      }

      if (activeQueues.length === 1) {
        // Single guild playing — show track + artist
        const q = activeQueues[0];
        const track = q.currentTrack;
        const artist = track.artist !== 'Unknown Artist' ? track.artist : null;
        const name = artist ? `${track.title} · ${artist}` : track.title;
        // Truncate to Discord's 128-char limit
        const truncated = name.length > 128 ? name.slice(0, 125) + '…' : name;

        this.client.user.setPresence({
          status: 'online',
          activities: [{
            name: truncated,
            type: ActivityType.Listening,
          }],
        });
      } else {
        // Multiple guilds — show count
        this.client.user.setPresence({
          status: 'online',
          activities: [{
            name: `music in ${activeQueues.length} servers`,
            type: ActivityType.Listening,
          }],
        });
      }
    } catch (err) {
      logger.error('Presence update failed:', err);
    }
  }
}

module.exports = { PresenceManager };
