const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

const STATE_DIR = process.env.STATE_DIR || '/data';
const ANNOUNCE_FILE = path.join(STATE_DIR, 'announce-channels.json');

function loadAnnounceChannels() {
  try {
    if (!fs.existsSync(ANNOUNCE_FILE)) return {};
    return JSON.parse(fs.readFileSync(ANNOUNCE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveAnnounceChannels(data) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(ANNOUNCE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error('Failed to save announce channels:', err);
  }
}

function getAnnounceChannelId(guildId) {
  return loadAnnounceChannels()[guildId] || null;
}

function setAnnounceChannelId(guildId, channelId) {
  const data = loadAnnounceChannels();
  data[guildId] = channelId;
  saveAnnounceChannels(data);
}

function clearAnnounceChannel(guildId) {
  const data = loadAnnounceChannels();
  delete data[guildId];
  saveAnnounceChannels(data);
}

/**
 * Resolves the announce channel for a guild.
 * Returns the Discord channel object, or null if not set / not found.
 */
async function resolveAnnounceChannel(client, guildId) {
  const channelId = getAnnounceChannelId(guildId);
  if (!channelId) return null;
  try {
    const guild = await client.guilds.fetch(guildId);
    return await guild.channels.fetch(channelId);
  } catch {
    return null;
  }
}

module.exports = {
  getAnnounceChannelId,
  setAnnounceChannelId,
  clearAnnounceChannel,
  resolveAnnounceChannel,
};
