const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const plex = require('./plex');
const { GuildQueue } = require('./queue');
const { canUseDJCommand, setDJRoleId, clearDJRole, getDJRoleId } = require('./roles');
const { setAnnounceChannelId, clearAnnounceChannel, getAnnounceChannelId } = require('./announce');
const db = require('./database');
const { wrappedCommand, statsCommand } = require('./wrapped');
const lidarr = require('./lidarr');
const { getCommunityPlaylistName, setCommunityPlaylistName, resetCommunityPlaylistName } = require('./database');
const logger = require('./utils/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getOrCreateQueue(client, interaction, member) {
  const guild = interaction.guild || member?.guild;
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) return { error: '❌ You must be in a voice channel first!' };

  if (!client.queue.has(guild.id)) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    const q = new GuildQueue(guild.id, connection, interaction.channel, client);
    client.queue.set(guild.id, q);
  }
  // Always update the text channel to wherever the command was just used
  // so now-playing messages go to the right place
  const queue = client.queue.get(guild.id);
  if (interaction.channel) queue.textChannel = interaction.channel;
  return { queue };
}

function formatDuration(sec) {
  if (!sec) return '?:??';
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

// Role check middleware — returns error string or null
function checkDJ(interaction) {
  const name = interaction.commandName;
  const member = interaction.member;
  if (!member) return null;
  if (!canUseDJCommand(member, name, interaction.guildId)) {
    const roleId = getDJRoleId(interaction.guildId);
    return '❌ You need the <@&' + roleId + '> role to use this command.';
  }
  return null;
}

// ─── Commands ─────────────────────────────────────────────────────────────────
const commands = [
  // ── play ──────────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('play')
      .setDescription('Search and play a track from Plex')
      .addStringOption(o => o.setName('query').setDescription('Track/artist/album name').setRequired(true)),
    async execute(interaction, client) {
      await interaction.deferReply();
      const query = interaction.options.getString('query');
      // Search first before joining voice channel
      const results = await plex.search(query);
      // If results come from an artist fallback (multiple tracks, all same artist),
      // queue all of them instead of just the first
      const isArtistFallback = results.length > 1 &&
        results.every(t => t.artist === results[0].artist) &&
        !results[0].title.toLowerCase().includes(query.toLowerCase());

      if (!results.length) {
        // No results — try Lidarr if configured
        if (lidarr.isConfigured()) {
          await interaction.editReply('❌ **' + query + '** not found in Plex. Searching Lidarr...');
          try {
            const candidates = await lidarr.searchArtist(query);
            if (!candidates.length) {
              return interaction.editReply('❌ **' + query + '** not found in Plex or Lidarr database.');
            }
            const artist = candidates[0];
            const result = await lidarr.addArtist(artist);
            if (!result.added && result.reason === 'already_exists') {
              return interaction.editReply(
                '❌ **' + query + '** not found in Plex yet.\n🔄 **' + artist.artistName + '** is already monitored in Lidarr — download may be pending.'
              );
            }
            return interaction.editReply(
              '❌ **' + query + '** not found in Plex.\n✅ Added **' + artist.artistName + '** to Lidarr! Zyntra will search for albums to download automatically.'
            );
          } catch (err) {
            logger.error('Lidarr request failed:', err.message);
            return interaction.editReply('❌ **' + query + '** not found in Plex. Lidarr request failed: ' + err.message);
          }
        }
        return interaction.editReply('❌ No results found for **' + query + '**');
      }
      const { queue, error } = getOrCreateQueue(client, interaction, interaction.member);
      if (error) return interaction.editReply(error);

      if (isArtistFallback) {
        // Queue all tracks from the artist (already shuffled by plex.search)
        let added = 0;
        for (const t of results) {
          const result = queue.addTrack({ ...t, requestedBy: { id: interaction.user.id, username: interaction.user.username } }, false);
          if (result.added) added++;
        }
        if (!queue.playing) await queue.playNext();
        return interaction.editReply('🎵 Queued **' + added + ' tracks** by **' + results[0].artist + '** (shuffled)');
      }

      const track = { ...results[0], requestedBy: { id: interaction.user.id, username: interaction.user.username } };
      const result = queue.addTrack(track);
      if (!result.added) return interaction.editReply('⚠️ ' + result.reason);
      if (!queue.playing) {
        await queue.playNext();
        await interaction.editReply('▶️ Playing **' + track.title + '** by ' + track.artist);
      } else {
        await interaction.editReply('➕ Added **' + track.title + '** by ' + track.artist + ' to the queue.');
      }
    },
  },

  // ── forceplay — bypass anti-duplicate ─────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('forceplay')
      .setDescription('Force-play a track even if it was recently played')
      .addStringOption(o => o.setName('query').setDescription('Track name').setRequired(true)),
    async execute(interaction, client) {
      await interaction.deferReply();
      const query = interaction.options.getString('query');
      // Search first before joining voice channel
      const results = await plex.search(query);
      if (!results.length) return interaction.editReply('❌ No results found for **' + query + '**');
      const { queue, error } = getOrCreateQueue(client, interaction, interaction.member);
      if (error) return interaction.editReply(error);
      const track = { ...results[0], requestedBy: { id: interaction.user.id, username: interaction.user.username } };
      queue.addTrack(track, true); // force=true bypasses duplicate check
      if (!queue.playing) {
        await queue.playNext();
        await interaction.editReply('▶️ Force-playing **' + track.title + '**');
      } else {
        await interaction.editReply('➕ Force-added **' + track.title + '** to the queue.');
      }
    },
  },

  // ── search ────────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('search')
      .setDescription('Search Plex and list results')
      .addStringOption(o => o.setName('query').setDescription('Search query').setRequired(true)),
    async execute(interaction, client) {
      await interaction.deferReply();
      const query = interaction.options.getString('query');
      const results = await plex.search(query);
      if (!results.length) return interaction.editReply('❌ No results for **' + query + '**');
      const list = results.slice(0, 10).map((t, i) =>
        '**' + (i + 1) + '.** ' + t.title + ' — ' + t.artist + ' *(' + formatDuration(t.duration) + ')*'
      ).join('\n');
      await interaction.editReply({
        embeds: [{ color: 0xe5a00d, title: '🔍 Search: "' + query + '"', description: list }],
      });
    },
  },

  // ── queue ─────────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder().setName('queue').setDescription('Show the current queue'),
    async execute(interaction, client) {
      const q = client.queue.get(interaction.guildId);
      if (!q || !q.currentTrack) return interaction.reply('📭 Queue is empty.');
      const upcoming = q.tracks.slice(0, 15).map((t, i) =>
        '**' + (i + 1) + '.** ' + t.title + ' — ' + t.artist
      ).join('\n') || '*No upcoming tracks*';
      await interaction.reply({
        embeds: [{
          color: 0xe5a00d,
          title: '📋 Queue',
          fields: [
            { name: '▶️ Now Playing', value: q.currentTrack.title + ' — ' + q.currentTrack.artist },
            { name: '📑 Up Next (' + q.tracks.length + ' tracks)', value: upcoming },
          ],
        }],
      });
    },
  },

  // ── skip ──────────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track'),
    async execute(interaction, client) {
      const djError = checkDJ(interaction);
      if (djError) return interaction.reply({ content: djError, ephemeral: true });
      const q = client.queue.get(interaction.guildId);
      if (!q || !q.currentTrack) return interaction.reply('❌ Nothing is playing.');
      q.skip();
      await interaction.reply('⏭️ Skipped!');
    },
  },

  // ── pause ─────────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
    async execute(interaction, client) {
      const djError = checkDJ(interaction);
      if (djError) return interaction.reply({ content: djError, ephemeral: true });
      const q = client.queue.get(interaction.guildId);
      if (!q) return interaction.reply('❌ Nothing is playing.');
      q.pause();
      await interaction.reply('⏸️ Paused.');
    },
  },

  // ── resume ────────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
    async execute(interaction, client) {
      const djError = checkDJ(interaction);
      if (djError) return interaction.reply({ content: djError, ephemeral: true });
      const q = client.queue.get(interaction.guildId);
      if (!q) return interaction.reply('❌ Nothing is playing.');
      q.resume();
      await interaction.reply('▶️ Resumed.');
    },
  },

  // ── stop ──────────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear queue'),
    async execute(interaction, client) {
      const djError = checkDJ(interaction);
      if (djError) return interaction.reply({ content: djError, ephemeral: true });
      const q = client.queue.get(interaction.guildId);
      if (!q) return interaction.reply('❌ Nothing is playing.');
      q.destroy();
      client.queue.delete(interaction.guildId);
      await interaction.reply('⏹️ Stopped and cleared queue.');
    },
  },

  // ── volume ────────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set playback volume (0–100)')
      .addIntegerOption(o => o.setName('level').setDescription('Volume level').setRequired(true).setMinValue(0).setMaxValue(100)),
    async execute(interaction, client) {
      const djError = checkDJ(interaction);
      if (djError) return interaction.reply({ content: djError, ephemeral: true });
      const q = client.queue.get(interaction.guildId);
      if (!q) return interaction.reply('❌ Nothing is playing.');
      const level = interaction.options.getInteger('level');
      q.setVolume(level / 100);
      await interaction.reply('🔊 Volume set to **' + level + '%**');
    },
  },

  // ── shuffle ───────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue'),
    async execute(interaction, client) {
      const djError = checkDJ(interaction);
      if (djError) return interaction.reply({ content: djError, ephemeral: true });
      const q = client.queue.get(interaction.guildId);
      if (!q || !q.tracks.length) return interaction.reply('❌ Queue is empty.');
      q.shuffle();
      await interaction.reply('🔀 Queue shuffled!');
    },
  },

  // ── loop ──────────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Toggle loop for current track or queue')
      .addStringOption(o =>
        o.setName('mode').setDescription('Loop mode').setRequired(true)
          .addChoices(
            { name: 'Track', value: 'track' },
            { name: 'Queue', value: 'queue' },
            { name: 'Off', value: 'off' }
          )
      ),
    async execute(interaction, client) {
      const djError = checkDJ(interaction);
      if (djError) return interaction.reply({ content: djError, ephemeral: true });
      const q = client.queue.get(interaction.guildId);
      if (!q) return interaction.reply('❌ Nothing is playing.');
      const mode = interaction.options.getString('mode');
      q.loop = mode === 'track';
      q.loopQueue = mode === 'queue';
      const icons = { track: '🔂', queue: '🔁', off: '➡️' };
      await interaction.reply(icons[mode] + ' Loop set to **' + mode + '**');
    },
  },

  // ── nowplaying ────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show current track info'),
    async execute(interaction, client) {
      const q = client.queue.get(interaction.guildId);
      if (!q || !q.currentTrack) return interaction.reply('❌ Nothing is playing.');
      const t = q.currentTrack;
      await interaction.reply({
        embeds: [{
          color: 0xe5a00d,
          title: '🎵 Now Playing',
          description: '**' + t.title + '**',
          fields: [
            { name: 'Artist', value: t.artist, inline: true },
            { name: 'Album', value: t.album, inline: true },
            { name: 'Duration', value: formatDuration(t.duration), inline: true },
            { name: 'Volume', value: Math.round(q.volume * 100) + '%', inline: true },
          ],
          thumbnail: t.thumb ? { url: t.thumb } : undefined,
        }],
      });
    },
  },


  // ── playlists — list all Plex audio playlists ─────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('playlists')
      .setDescription('List all available Plex audio playlists'),
    async execute(interaction, client) {
      await interaction.deferReply();
      const playlists = await plex.getPlaylists();
      if (!playlists.length) {
        return interaction.editReply('❌ No audio playlists found in Plex.');
      }
      const list = playlists
        .map((p, i) => '**' + (i + 1) + '.** ' + p.title + ' *(' + (p.count || '?') + ' tracks)*')
        .join('\n');
      await interaction.editReply({
        embeds: [{
          color: 0xe5a00d,
          title: '📋 Plex Playlists',
          description: list,
          footer: { text: 'Use /playlist <name> to play one' },
        }],
      });
    },
  },

  // ── playlist ──────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('playlist')
      .setDescription('Play a Plex playlist')
      .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true)),
    async execute(interaction, client) {
      const djError = checkDJ(interaction);
      if (djError) return interaction.reply({ content: djError, ephemeral: true });
      await interaction.deferReply();
      const name = interaction.options.getString('name');
      const playlists = await plex.getPlaylists();
      const pl = playlists.find(p => p.title.toLowerCase().includes(name.toLowerCase()));
      if (!pl) return interaction.editReply('❌ No playlist found matching **' + name + '**');
      const tracks = await plex.getPlaylistTracks(pl.key);
      if (!tracks.length) return interaction.editReply('❌ Playlist is empty.');
      const { queue, error } = getOrCreateQueue(client, interaction, interaction.member);
      if (error) return interaction.editReply(error);
      const added = queue.addTracks(tracks);
      if (!queue.playing) queue.playNext();
      const skipped = tracks.length - added;
      let reply = '📋 Added **' + added + '** tracks from playlist **' + pl.title + '**';
      if (skipped > 0) reply += ' (' + skipped + ' duplicate(s) skipped)';
      await interaction.editReply(reply);
    },
  },

  // ── album ─────────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('album')
      .setDescription('Play a full album from Plex')
      .addStringOption(o => o.setName('name').setDescription('Album name').setRequired(true)),
    async execute(interaction, client) {
      const djError = checkDJ(interaction);
      if (djError) return interaction.reply({ content: djError, ephemeral: true });
      await interaction.deferReply();
      const name = interaction.options.getString('name');
      const tracks = await plex.getAlbumTracks(name);
      if (!tracks.length) return interaction.editReply('❌ No album found matching **' + name + '**');
      const { queue, error } = getOrCreateQueue(client, interaction, interaction.member);
      if (error) return interaction.editReply(error);
      const added = queue.addTracks(tracks);
      if (!queue.playing) queue.playNext();
      const skipped = tracks.length - added;
      let reply = '💿 Added **' + added + '** tracks from **' + tracks[0].album + '**';
      if (skipped > 0) reply += ' (' + skipped + ' duplicate(s) skipped)';
      await interaction.editReply(reply);
    },
  },

  // ── djrole ────────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('djrole')
      .setDescription('Set or clear the DJ role required for playback controls')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(sub =>
        sub.setName('set')
          .setDescription('Set the DJ role')
          .addRoleOption(o => o.setName('role').setDescription('The role to assign as DJ').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('clear')
          .setDescription('Remove DJ role restriction (everyone can use controls)')
      )
      .addSubcommand(sub =>
        sub.setName('info')
          .setDescription('Show the current DJ role setting')
      ),
    async execute(interaction, client) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'set') {
        const role = interaction.options.getRole('role');
        setDJRoleId(interaction.guildId, role.id);
        await interaction.reply({
          embeds: [{
            color: 0xe5a00d,
            title: '🎧 DJ Role Set',
            description: 'Only members with <@&' + role.id + '> (or server admins) can now use playback controls.\n\n**Anyone can still:** `/play`, `/search`, `/queue`, `/nowplaying`\n**DJ role required:** `/skip`, `/stop`, `/pause`, `/resume`, `/volume`, `/shuffle`, `/loop`, `/playlist`, `/album`, `/disconnect`',
          }],
        });
      } else if (sub === 'clear') {
        clearDJRole(interaction.guildId);
        await interaction.reply('✅ DJ role restriction removed. Everyone can use all controls.');
      } else if (sub === 'info') {
        const roleId = getDJRoleId(interaction.guildId);
        if (!roleId) {
          await interaction.reply('ℹ️ No DJ role set — everyone can use all controls.');
        } else {
          await interaction.reply('🎧 Current DJ role: <@&' + roleId + '>');
        }
      }
    },
  },


  // ── announce ──────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('announce')
      .setDescription('Set or clear the dedicated now-playing announce channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(sub =>
        sub.setName('set')
          .setDescription('Set a channel for now-playing notifications')
          .addChannelOption(o => o.setName('channel').setDescription('The text channel to post now-playing embeds in').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('clear')
          .setDescription('Remove the announce channel (posts in command channel instead)')
      )
      .addSubcommand(sub =>
        sub.setName('info')
          .setDescription('Show the current announce channel')
      ),
    async execute(interaction, client) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'set') {
        const channel = interaction.options.getChannel('channel');
        // Verify it is a text channel
        if (!channel.isTextBased()) {
          return interaction.reply({ content: '❌ Please choose a text channel.', ephemeral: true });
        }
        setAnnounceChannelId(interaction.guildId, channel.id);
        await interaction.reply({
          embeds: [{
            color: 0xe5a00d,
            title: '📣 Announce Channel Set',
            description: 'Now-playing notifications will be posted in <#' + channel.id + '>.',
            fields: [
              { name: 'Tip', value: 'Consider making this channel read-only for members so it stays clean. Zyntra only needs permission to Send Messages and Embed Links there.' },
            ],
          }],
        });
      } else if (sub === 'clear') {
        clearAnnounceChannel(interaction.guildId);
        await interaction.reply('✅ Announce channel cleared. Now-playing will post in whichever channel commands are used.');
      } else if (sub === 'info') {
        const channelId = getAnnounceChannelId(interaction.guildId);
        if (!channelId) {
          await interaction.reply('ℹ️ No announce channel set — now-playing posts in the command channel.');
        } else {
          await interaction.reply('📣 Current announce channel: <#' + channelId + '>');
        }
      }
    },
  },



  // ── communityplaylist ─────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('communityplaylist')
      .setDescription('Manage this server community playlist')
      .setDefaultMemberPermissions(0x20) // Manage Server
      .addSubcommand(sub => sub
        .setName('info')
        .setDescription('Show the current community playlist name'))
      .addSubcommand(sub => sub
        .setName('name')
        .setDescription('Set a custom name for this server community playlist')
        .addStringOption(o => o.setName('name').setDescription('New playlist name').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('reset')
        .setDescription('Reset the playlist name back to the server default')),
    async execute(interaction, client) {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guildId;
      const guildName = interaction.guild.name;
      const db = require('./database');
      const current = db.getCommunityPlaylistName(guildId, guildName);

      if (sub === 'info') {
        return interaction.reply({
          embeds: [{
            color: 0x1db954,
            title: '🎵 Community Playlist',
            fields: [
              { name: 'Current name', value: current, inline: false },
              { name: 'Default name', value: guildName + ' Community', inline: false },
              { name: 'Play it with', value: '`/playlist ' + current + '`', inline: false },
            ],
            footer: { text: 'React 👍 on now-playing messages to vote tracks in' },
          }],
        });
      }

      if (sub === 'name') {
        const newName = interaction.options.getString('name').trim();
        if (newName.length < 2 || newName.length > 100) {
          return interaction.reply({ content: '❌ Playlist name must be between 2 and 100 characters.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        try {
          // Rename the existing Plex playlist in place if it exists
          await plex.renameCommunityPlaylist(guildId, current, newName).catch(() => {});
          db.setCommunityPlaylistName(guildId, newName);
          return interaction.editReply('✅ Community playlist renamed to **' + newName + '**');
        } catch (err) {
          return interaction.editReply('❌ Failed to rename: ' + err.message);
        }
      }

      if (sub === 'reset') {
        await interaction.deferReply({ ephemeral: true });
        const defaultName = guildName + ' Community';
        try {
          await plex.renameCommunityPlaylist(guildId, current, defaultName).catch(() => {});
          db.resetCommunityPlaylistName(guildId);
          return interaction.editReply('✅ Community playlist reset to **' + defaultName + '**');
        } catch (err) {
          return interaction.editReply('❌ Failed to reset: ' + err.message);
        }
      }
    },
  },


  // ── personalities ─────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('personalities')
      .setDescription('Show how Zyntra music personalities are determined'),
    async execute(interaction, client) {
      await interaction.reply({
        embeds: [{
          color: 0xe5a00d,
          title: '🎭 Zyntra Music Personalities',
          description: 'Conditions are checked top to bottom — first match wins.',
          fields: [
            { name: '🌙 Midnight Loop', value: 'Night Owl **and** Repeat Offender both true\n*Up late, same song on repeat*', inline: false },
            { name: '🦉 Night Shift DJ', value: 'Night Owl **and** total plays **> 200**\n*Heavy late-night usage*', inline: false },
            { name: '🔁 Repeat Offender', value: 'Top track accounts for **> 20%** of all plays\n*Found a banger, never let go*', inline: false },
            { name: '🌙 Night Owl', value: 'Peak listening hour between **10pm – 4am**\n*Music sounds better after midnight*', inline: false },
            { name: '🎭 Genre Hopper', value: 'Unique artists ÷ total plays **> 60%**\n*Wide variety, no loyalty to one sound*', inline: false },
            { name: '💿 Album Loyalist', value: 'Unique artists ÷ total plays **< 15%**\n*Sticks to a few artists and goes deep*', inline: false },
            { name: '🎧 Main DJ', value: 'Total plays **> 200**\n*Running the server playlist at this point*', inline: false },
            { name: '🎵 Music Lover', value: 'None of the above — the default\n*Here for the vibes, no further questions*', inline: false },
          ],
          footer: { text: 'Run /wrapped me to see your personality' },
        }],
      });
    },
  },

  // ── disconnect ────────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder().setName('disconnect').setDescription('Disconnect the bot from voice'),
    async execute(interaction, client) {
      const djError = checkDJ(interaction);
      if (djError) return interaction.reply({ content: djError, ephemeral: true });
      const q = client.queue.get(interaction.guildId);
      if (q) {
        q.destroy();
        client.queue.delete(interaction.guildId);
      }
      await interaction.reply('👋 Disconnected.');
    },
  },
];

// Append wrapped and stats commands
commands.push(wrappedCommand, statsCommand);

async function loadCommands(client) {
  for (const cmd of commands) {
    client.commands.set(cmd.data.name, cmd);
  }
  logger.info('Loaded ' + commands.length + ' commands.');
}

module.exports = { loadCommands, commands };
