const { PresenceManager } = require('./presence');
const { restoreQueues } = require('./persistence');
const logger = require('./utils/logger');

const PREFIX = process.env.TEXT_PREFIX || '!';

async function loadEvents(client) {
  // Single 'ready' handler — creates PresenceManager AFTER login,
  // then starts presence and restores queues
  client.once('ready', async () => {
    logger.info(`Logged in as ${client.user.tag}`);

    // Safe to create PresenceManager now — discord.js has finished
    // setting up its own client.presence internals during login
    client.presenceManager = new PresenceManager(client);
    client.presenceManager.start();

    await restoreQueues(client);
  });

  // Slash command handler
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client);
    } catch (err) {
      logger.error('Error executing /' + interaction.commandName + ':', err);
      const msg = { content: '❌ An error occurred.', ephemeral: true };
      if (interaction.deferred) await interaction.editReply(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
  });

  // Text command handler
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    const query = args.join(' ');

    const command = client.commands.get(commandName);
    if (!command) return;

    const fakeInteraction = makeFakeInteraction(message, commandName, query);
    try {
      await command.execute(fakeInteraction, client);
    } catch (err) {
      logger.error(`Error executing text command ${commandName}:`, err);
      message.reply('❌ An error occurred.').catch(() => {});
    }
  });

  // Thumbs up reaction listener for community playlist
  const REACTION_THRESHOLD = parseInt(process.env.COMMUNITY_PLAYLIST_THRESHOLD || '3');
  const REACTION_EMOJI = '👍';
  const { getCommunityPlaylistName } = require('./database');
  const plex = require('./plex');

  client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.emoji.name !== REACTION_EMOJI) return;

    // Fetch full reaction if partial
    if (reaction.partial) {
      try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.message.partial) {
      try { await reaction.message.fetch(); } catch { return; }
    }

    // Only watch messages posted by Zyntra
    if (reaction.message.author?.id !== client.user?.id) return;

    // Count unique non-bot reactions
    const users = await reaction.users.fetch();
    const uniqueCount = users.filter(u => !u.bot).size;
    if (uniqueCount < REACTION_THRESHOLD) return;

    // Extract track info from the embed
    const embed = reaction.message.embeds?.[0];
    if (!embed) return;

    const guildId = reaction.message.guildId;
    const guildName = reaction.message.guild?.name || 'Zyntra';

    // Get this guild's community playlist name
    const playlistName = getCommunityPlaylistName(guildId, guildName);

    // Find the queue to get the current track's ratingKey
    const queue = client.queue?.get(guildId);
    let ratingKey = null;

    if (queue?.currentTrack?.ratingKey) {
      ratingKey = queue.currentTrack.ratingKey;
    } else {
      // Fall back to searching by title from embed
      const title = (embed.title || '').replace(/^[▶️  ]+/, '').split(' — ')[0].trim();
      if (!title) return;
      const results = await plex.search(title);
      if (!results.length) return;
      ratingKey = results[0].ratingKey;
    }

    if (!ratingKey) return;

    try {
      const result = await plex.addTrackToCommunityPlaylist(ratingKey, playlistName);
      if (result.added) {
        await reaction.message.reply({
          embeds: [{
            color: 0x1db954,
            description: '\u{1F44D} Added to **' + playlistName + '** after ' + uniqueCount + ' votes!\nPlay it with `/playlist ' + playlistName + '`',
          }],
        }).catch(() => {});
        logger.info('Community playlist: added track ' + ratingKey + ' to "' + playlistName + '" in guild ' + guildId);
      }
    } catch (err) {
      logger.error('Community playlist error:', err.message);
    }
  });

  logger.info('Events loaded.');
}

function makeFakeInteraction(message, commandName, query) {
  const sendReply = async (content) => {
    if (typeof content === 'string') return message.reply(content).catch(() => {});
    return message.reply({ embeds: content.embeds || [], content: content.content || '' }).catch(() => {});
  };

  return {
    guild: message.guild,
    guildId: message.guildId,
    channel: message.channel,
    member: message.member,
    user: message.author,
    commandName,
    deferred: false,
    options: {
      getString: (_name) => query || null,
      getInteger: (_name) => { const n = parseInt(query); return isNaN(n) ? null : n; },
      getSubcommand: () => null,
      getRole: () => null,
      getChannel: () => null,
    },
    deferReply: async () => {},
    reply: sendReply,
    editReply: sendReply,
  };
}

module.exports = { loadEvents };
