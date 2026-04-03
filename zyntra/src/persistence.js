const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

const STATE_DIR = process.env.STATE_DIR || '/data';
const STATE_FILE = path.join(STATE_DIR, 'queue-state.json');

/**
 * Saves the current queue state for all guilds to disk.
 * Called whenever the queue changes significantly.
 */
function saveState(client) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

    const state = {};
    for (const [guildId, q] of client.queue.entries()) {
      const voiceChannelId = q.connection?.joinConfig?.channelId;
      const textChannelId = q.textChannel?.id;
      if (!voiceChannelId) continue;

      state[guildId] = {
        voiceChannelId,
        textChannelId,
        currentTrack: q.currentTrack,
        tracks: q.tracks,
        volume: q.volume,
        loop: q.loop,
        loopQueue: q.loopQueue,
        savedAt: Date.now(),
      };
    }

    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    logger.debug('Queue state saved.');
  } catch (err) {
    logger.error('Failed to save queue state:', err);
  }
}

/**
 * Restores queue state from disk on startup.
 * Returns the saved state object, or null if none exists / too old.
 */
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;

    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const state = JSON.parse(raw);

    // Discard state older than 24 hours
    const maxAge = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const valid = {};
    for (const [guildId, data] of Object.entries(state)) {
      if (now - data.savedAt < maxAge) {
        valid[guildId] = data;
      }
    }

    if (!Object.keys(valid).length) return null;
    logger.info(`Loaded saved queue state for ${Object.keys(valid).length} guild(s).`);
    return valid;
  } catch (err) {
    logger.error('Failed to load queue state:', err);
    return null;
  }
}

/**
 * Clears saved state for a specific guild (e.g. after /stop).
 */
function clearGuildState(guildId) {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const state = JSON.parse(raw);
    delete state[guildId];
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

/**
 * Attempts to restore queues after the bot is ready.
 * Rejoins voice channels and resumes queues.
 */
async function restoreQueues(client) {
  const state = loadState();
  if (!state) return;

  const { joinVoiceChannel } = require('@discordjs/voice');
  const { GuildQueue } = require('./queue');

  for (const [guildId, data] of Object.entries(state)) {
    try {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) continue;

      const voiceChannel = await guild.channels.fetch(data.voiceChannelId).catch(() => null);
      if (!voiceChannel) continue;

      const textChannel = data.textChannelId
        ? await guild.channels.fetch(data.textChannelId).catch(() => null)
        : null;

      const allTracks = [
        ...(data.currentTrack ? [data.currentTrack] : []),
        ...data.tracks,
      ];
      if (!allTracks.length) continue;

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      const q = new GuildQueue(guild.id, connection, textChannel, client);
      q.volume = data.volume ?? 0.5;
      q.loop = data.loop ?? false;
      q.loopQueue = data.loopQueue ?? false;
      q.addTracks(allTracks);
      client.queue.set(guildId, q);

      // Start playing
      await q.playNext();

      if (textChannel) {
        textChannel.send({
          embeds: [{
            color: 0xe5a00d,
            title: '🔄 Queue Restored',
            description: `Zyntra restarted and resumed your queue with **${allTracks.length}** track(s).`,
            footer: { text: 'Resume on restart • Zyntra' },
          }],
        }).catch(() => {});
      }

      logger.info(`Restored queue for guild ${guildId} with ${allTracks.length} track(s).`);
    } catch (err) {
      logger.error(`Failed to restore queue for guild ${guildId}:`, err);
    }
  }
}

module.exports = { saveState, loadState, clearGuildState, restoreQueues };
