require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { loadCommands } = require('./commands');
const { loadEvents } = require('./events');
const { startWebServer } = require('../web/server');
const { PresenceManager } = require('./presence');
const { restoreQueues } = require('./persistence');
const { openDatabase } = require('./database');
const logger = require('./utils/logger');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();
client.queue = new Map(); // guildId -> GuildQueue
client.presenceManager = new PresenceManager(client);

async function main() {
  logger.info('Starting Zyntra...');
  openDatabase();

  await loadCommands(client);
  await loadEvents(client); // registers the 'ready' handler for presence + restore

  // Register slash commands with Discord
  if (process.env.DISCORD_GUILD_ID) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const commandData = [...client.commands.values()].map(c => c.data.toJSON());
    try {
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
        { body: commandData }
      );
      logger.info(`Registered ${commandData.length} slash commands to guild.`);
    } catch (err) {
      logger.error('Failed to register slash commands:', err);
    }
  }

  await client.login(process.env.DISCORD_TOKEN);
  startWebServer(client);
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
