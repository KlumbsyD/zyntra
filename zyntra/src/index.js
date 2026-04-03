require('dotenv').config();
const logger = require('./utils/logger');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { loadCommands } = require('./commands');
const { loadEvents } = require('./events');
const { startWebServer } = require('../web/server');
const { restoreQueues } = require('./persistence');
const { openDatabase } = require('./database');

// Pre-load libsodium-wrappers before @discordjs/voice initializes
// sodium-native prebuilds don't work on Alpine Linux (musl libc)
require('libsodium-wrappers').ready
  .then(() => logger.info('libsodium ready.'))
  .catch(err => logger.error('libsodium failed:', err));

const { Partials } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
  // Partials are needed to receive reactions on messages not cached at startup
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.commands = new Collection();
client.queue = new Map();

// Helper — register slash commands to a single guild
async function registerCommandsToGuild(rest, guildId) {
  const commandData = [...client.commands.values()].map(c => c.data.toJSON());
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
      { body: commandData }
    );
    logger.info(`Registered ${commandData.length} slash commands to guild ${guildId}.`);
  } catch (err) {
    logger.error(`Failed to register commands to guild ${guildId}:`, err.message);
  }
}

async function main() {
  logger.info('Starting Zyntra...');
  openDatabase();

  await loadCommands(client);
  await loadEvents(client);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  // Register commands to all current guilds on startup
  // This handles guilds the bot was already in before this restart
  client.once('ready', async () => {
    const guilds = client.guilds.cache.map(g => g.id);
    logger.info(`Registering commands to ${guilds.length} guild(s)...`);
    for (const guildId of guilds) {
      await registerCommandsToGuild(rest, guildId);
    }
  });

  // Register commands instantly when the bot joins a new guild
  // This gives instant slash commands with no propagation delay
  client.on('guildCreate', async (guild) => {
    logger.info(`Joined new guild: ${guild.name} (${guild.id}) — registering commands...`);
    await registerCommandsToGuild(rest, guild.id);
  });

  await client.login(process.env.DISCORD_TOKEN);
  startWebServer(client);
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
