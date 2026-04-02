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
      logger.error(`Error executing /${interaction.commandName}:`, err);
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
