const { SlashCommandBuilder } = require('discord.js');
const db = require('./database');

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtTime(seconds) {
  if (!seconds) return '0 min';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

function medal(i) {
  return ['🥇','🥈','🥉','4️⃣','5️⃣'][i] || `${i+1}.`;
}

// ─── /wrapped ─────────────────────────────────────────────────────────────────

const wrappedCommand = {
  data: new SlashCommandBuilder()
    .setName('wrapped')
    .setDescription('Your Zyntra Wrapped — a year in music')
    .addSubcommand(sub =>
      sub.setName('me')
        .setDescription('See your personal Wrapped for this year')
    )
    .addSubcommand(sub =>
      sub.setName('user')
        .setDescription("See someone else's Wrapped")
        .addUserOption(o => o.setName('target').setDescription('User to view').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('server')
        .setDescription("See the server's Wrapped for this year")
    ),

  async execute(interaction, client) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();
    const year = new Date().getFullYear();

    if (sub === 'server') {
      await sendServerWrapped(interaction, year);
    } else {
      const target = sub === 'user'
        ? interaction.options.getUser('target')
        : interaction.user;
      await sendUserWrapped(interaction, target, year);
    }
  },
};

async function sendUserWrapped(interaction, user, year) {
  const guildId = interaction.guildId;
  const userId = user.id;

  const total       = db.getUserTotalPlays(guildId, userId, year);
  const listenTime  = db.getUserListeningTime(guildId, userId, year);
  const topTracks   = db.getUserTopTracks(guildId, userId, year, 5);
  const topArtists  = db.getUserTopArtists(guildId, userId, year, 5);
  const peakMonth   = db.getUserPeakMonth(guildId, userId, year);
  const peakHour    = db.getUserPeakHour(guildId, userId, year);
  const uniqueArtists = db.getUserUniqueArtists(guildId, userId, year);
  const personality = db.getUserPersonality(guildId, userId, year);

  if (total === 0) {
    return interaction.editReply({
      embeds: [{
        color: 0x1db954,
        title: `🎵 ${user.displayName}'s Wrapped ${year}`,
        description: "No listening history yet this year! Start queuing tracks with `/play`.",
      }],
    });
  }

  const peakMonthStr = peakMonth ? `${MONTHS[peakMonth.month]} (${peakMonth.count} tracks)` : 'N/A';
  const peakHourStr  = peakHour
    ? (() => {
        const h = peakHour.hour;
        const ampm = h < 12 ? 'AM' : 'PM';
        const h12 = h % 12 || 12;
        return `${h12}:00 ${ampm}`;
      })()
    : 'N/A';

  const topTracksStr = topTracks.length
    ? topTracks.map((t, i) => `${medal(i)} **${t.title}** — ${t.artist} *(×${t.plays})*`).join('\n')
    : '*No data*';

  const topArtistsStr = topArtists.length
    ? topArtists.map((a, i) => `${medal(i)} **${a.artist}** *(${a.plays} plays)*`).join('\n')
    : '*No data*';

  // Send slides in sequence
  const slides = [
    // Slide 1 — Intro
    {
      color: 0x1db954,
      title: `🎵 ${user.displayName}'s Wrapped ${year}`,
      description: `Here's your year in music on Zyntra.\n\nYou requested **${total} tracks** this year and spent approximately **${fmtTime(listenTime)}** listening to music.\n\nYou explored **${uniqueArtists} different artists**. Let's dive in... 🎧`,
      thumbnail: { url: user.displayAvatarURL() },
      footer: { text: `Zyntra Wrapped ${year} • Slide 1 of 5` },
    },
    // Slide 2 — Top Tracks
    {
      color: 0xe5a00d,
      title: '🏆 Your Top Tracks',
      description: topTracksStr,
      footer: { text: `Zyntra Wrapped ${year} • Slide 2 of 5` },
    },
    // Slide 3 — Top Artists
    {
      color: 0x5865f2,
      title: '🎤 Your Top Artists',
      description: topArtistsStr,
      footer: { text: `Zyntra Wrapped ${year} • Slide 3 of 5` },
    },
    // Slide 4 — Listening habits
    {
      color: 0xf04747,
      title: '📊 Your Listening Habits',
      fields: [
        { name: '📅 Most Active Month', value: peakMonthStr, inline: true },
        { name: '🕐 Favourite Hour', value: peakHourStr, inline: true },
        { name: '🎵 Total Tracks', value: total.toString(), inline: true },
        { name: '⏱️ Time Listening', value: fmtTime(listenTime), inline: true },
        { name: '🎤 Unique Artists', value: uniqueArtists.toString(), inline: true },
      ],
      footer: { text: `Zyntra Wrapped ${year} • Slide 4 of 5` },
    },
    // Slide 5 — Personality
    {
      color: 0xff73fa,
      title: '🎭 Your Music Personality',
      description: personality
        ? `## ${personality.label}\n\n${personality.desc}`
        : '🎵 Music Lover\n\nHere for the vibes.',
      footer: { text: `Zyntra Wrapped ${year} • Slide 5 of 5` },
    },
  ];

  // Send first slide as the reply, rest as follow-ups
  await interaction.editReply({ embeds: [slides[0]] });
  for (let i = 1; i < slides.length; i++) {
    await interaction.followUp({ embeds: [slides[i]] });
  }
}

async function sendServerWrapped(interaction, year) {
  const guildId = interaction.guildId;
  const guild   = interaction.guild;

  const total       = db.getServerTotalPlays(guildId, year);
  const topTracks   = db.getServerTopTracks(guildId, year, 5);
  const topArtists  = db.getServerTopArtists(guildId, year, 5);
  const topDJs      = db.getServerTopDJs(guildId, year, 5);
  const peakMonth   = db.getServerPeakMonth(guildId, year);
  const uniqueUsers = db.getServerUniqueUsers(guildId, year);

  if (total === 0) {
    return interaction.editReply({
      embeds: [{
        color: 0x1db954,
        title: `🎵 ${guild.name}'s Wrapped ${year}`,
        description: "No listening history yet this year!",
      }],
    });
  }

  const peakMonthStr = peakMonth ? `${MONTHS[peakMonth.month]} (${peakMonth.count} tracks)` : 'N/A';

  const topTracksStr = topTracks.length
    ? topTracks.map((t, i) => `${medal(i)} **${t.title}** — ${t.artist} *(×${t.plays})*`).join('\n')
    : '*No data*';

  const topArtistsStr = topArtists.length
    ? topArtists.map((a, i) => `${medal(i)} **${a.artist}** *(${a.plays} plays)*`).join('\n')
    : '*No data*';

  const topDJsStr = topDJs.length
    ? topDJs.map((u, i) => `${medal(i)} **${u.username}** *(${u.plays} tracks)*`).join('\n')
    : '*No data*';

  const topDJ = topDJs[0];

  const slides = [
    // Slide 1 — Intro
    {
      color: 0x1db954,
      title: `🎵 ${guild.name}'s Wrapped ${year}`,
      description: `Here's your server's year in music on Zyntra.\n\n**${total} tracks** were played this year by **${uniqueUsers} DJs**.\n\nLet's see what you've all been listening to... 🎧`,
      thumbnail: guild.iconURL() ? { url: guild.iconURL() } : undefined,
      footer: { text: `Zyntra Wrapped ${year} • Slide 1 of 5` },
    },
    // Slide 2 — Top Tracks
    {
      color: 0xe5a00d,
      title: '🏆 Server Top Tracks',
      description: topTracksStr,
      footer: { text: `Zyntra Wrapped ${year} • Slide 2 of 5` },
    },
    // Slide 3 — Top Artists
    {
      color: 0x5865f2,
      title: '🎤 Server Top Artists',
      description: topArtistsStr,
      footer: { text: `Zyntra Wrapped ${year} • Slide 3 of 5` },
    },
    // Slide 4 — Top DJs
    {
      color: 0xf04747,
      title: '🎧 Top DJs of the Year',
      description: topDJsStr,
      footer: { text: `Zyntra Wrapped ${year} • Slide 4 of 5` },
    },
    // Slide 5 — Server highlights
    {
      color: 0xff73fa,
      title: '📊 Server Highlights',
      fields: [
        { name: '🎵 Total Tracks Played', value: total.toString(), inline: true },
        { name: '👥 Active DJs', value: uniqueUsers.toString(), inline: true },
        { name: '📅 Most Active Month', value: peakMonthStr, inline: true },
        { name: '👑 #1 DJ', value: topDJ ? `${topDJ.username} (${topDJ.plays} tracks)` : 'N/A', inline: true },
        { name: '🎤 Top Artist', value: topArtists[0]?.artist || 'N/A', inline: true },
        { name: '🏆 Top Track', value: topTracks[0]?.title || 'N/A', inline: true },
      ],
      footer: { text: `Zyntra Wrapped ${year} • Slide 5 of 5` },
    },
  ];

  await interaction.editReply({ embeds: [slides[0]] });
  for (let i = 1; i < slides.length; i++) {
    await interaction.followUp({ embeds: [slides[i]] });
  }
}

// ─── /stats ───────────────────────────────────────────────────────────────────

const statsCommand = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View listening stats')
    .addSubcommand(sub =>
      sub.setName('me')
        .setDescription('Your personal listening stats')
    )
    .addSubcommand(sub =>
      sub.setName('user')
        .setDescription("View another user's stats")
        .addUserOption(o => o.setName('target').setDescription('User to view').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('server')
        .setDescription('Server-wide listening stats')
    )
    .addSubcommand(sub =>
      sub.setName('track')
        .setDescription('How many times a track has been played')
        .addStringOption(o => o.setName('name').setDescription('Track name').setRequired(true))
    ),

  async execute(interaction, client) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();
    const year = new Date().getFullYear();
    const guildId = interaction.guildId;

    if (sub === 'me' || sub === 'user') {
      const user = sub === 'user' ? interaction.options.getUser('target') : interaction.user;
      const userId = user.id;

      const total        = db.getUserTotalPlays(guildId, userId, year);
      const listenTime   = db.getUserListeningTime(guildId, userId, year);
      const topTracks    = db.getUserTopTracks(guildId, userId, year, 3);
      const topArtists   = db.getUserTopArtists(guildId, userId, year, 3);
      const uniqueArtists = db.getUserUniqueArtists(guildId, userId, year);
      const personality  = db.getUserPersonality(guildId, userId, year);

      const topTracksStr = topTracks.length
        ? topTracks.map((t, i) => `${medal(i)} **${t.title}** — ${t.artist} *(×${t.plays})*`).join('\n')
        : '*None yet*';

      const topArtistsStr = topArtists.length
        ? topArtists.map((a, i) => `${medal(i)} **${a.artist}** *(${a.plays} plays)*`).join('\n')
        : '*None yet*';

      await interaction.editReply({
        embeds: [{
          color: 0xe5a00d,
          title: `📊 ${user.displayName}'s Stats — ${year}`,
          thumbnail: { url: user.displayAvatarURL() },
          fields: [
            { name: '🎵 Tracks Requested', value: total.toString(), inline: true },
            { name: '⏱️ Time Listening', value: fmtTime(listenTime), inline: true },
            { name: '🎤 Unique Artists', value: uniqueArtists.toString(), inline: true },
            { name: '🏆 Top Tracks', value: topTracksStr, inline: false },
            { name: '🎤 Top Artists', value: topArtistsStr, inline: false },
            { name: '🎭 Music Personality', value: personality ? `${personality.label} — ${personality.desc}` : 'Not enough data yet', inline: false },
          ],
          footer: { text: `Use /wrapped me for the full experience` },
        }],
      });

    } else if (sub === 'server') {
      const total      = db.getServerTotalPlays(guildId, year);
      const topDJs     = db.getServerTopDJs(guildId, year, 5);
      const topTracks  = db.getServerTopTracks(guildId, year, 3);
      const topArtists = db.getServerTopArtists(guildId, year, 3);
      const uniqueUsers = db.getServerUniqueUsers(guildId, year);

      const topDJsStr = topDJs.length
        ? topDJs.map((u, i) => `${medal(i)} **${u.username}** *(${u.plays} tracks)*`).join('\n')
        : '*None yet*';

      const topTracksStr = topTracks.length
        ? topTracks.map((t, i) => `${medal(i)} **${t.title}** — ${t.artist} *(×${t.plays})*`).join('\n')
        : '*None yet*';

      const topArtistsStr = topArtists.length
        ? topArtists.map((a, i) => `${medal(i)} **${a.artist}** *(${a.plays} plays)*`).join('\n')
        : '*None yet*';

      await interaction.editReply({
        embeds: [{
          color: 0xe5a00d,
          title: `📊 ${interaction.guild.name} — Server Stats ${year}`,
          thumbnail: interaction.guild.iconURL() ? { url: interaction.guild.iconURL() } : undefined,
          fields: [
            { name: '🎵 Total Tracks Played', value: total.toString(), inline: true },
            { name: '👥 Active DJs', value: uniqueUsers.toString(), inline: true },
            { name: '🎧 Top DJs', value: topDJsStr, inline: false },
            { name: '🏆 Top Tracks', value: topTracksStr, inline: false },
            { name: '🎤 Top Artists', value: topArtistsStr, inline: false },
          ],
          footer: { text: `Use /wrapped server for the full experience` },
        }],
      });

    } else if (sub === 'track') {
      const name = interaction.options.getString('name');
      if (!db) return interaction.editReply('❌ Database not available.');

      const { start, end } = (() => {
        const s = new Date(year, 0, 1).getTime();
        const e = new Date(year + 1, 0, 1).getTime();
        return { start: s, end: e };
      })();

      const Database = require('better-sqlite3');
      // Re-use the db module's internal db instance via a query
      const rows = db.getUserTopTracks ? null : null; // handled below via direct query workaround

      // Use the exported function pattern — search by title
      const allPlays = (() => {
        try {
          const BetterSqlite = require('better-sqlite3');
          const path = require('path');
          const STATE_DIR = process.env.STATE_DIR || '/data';
          const tmpDb = new BetterSqlite(path.join(STATE_DIR, 'zyntra.db'));
          const results = tmpDb.prepare(`
            SELECT title, artist, username, COUNT(*) as plays
            FROM play_history
            WHERE guild_id=? AND LOWER(title) LIKE ? AND played_at>=? AND played_at<?
            GROUP BY track_key, username
            ORDER BY plays DESC
            LIMIT 10
          `).all(guildId, '%' + name.toLowerCase() + '%', start, end);
          tmpDb.close();
          return results;
        } catch { return []; }
      })();

      if (!allPlays.length) {
        return interaction.editReply(`❌ No plays found for tracks matching **${name}** this year.`);
      }

      const grouped = {};
      for (const row of allPlays) {
        if (!grouped[row.title]) grouped[row.title] = { title: row.title, artist: row.artist, total: 0, users: [] };
        grouped[row.title].total += row.plays;
        grouped[row.title].users.push(`${row.username} *(×${row.plays})*`);
      }

      const fields = Object.values(grouped).slice(0, 3).map(t => ({
        name: `🎵 ${t.title} — ${t.artist} (${t.total} total plays)`,
        value: t.users.join(', '),
        inline: false,
      }));

      await interaction.editReply({
        embeds: [{
          color: 0xe5a00d,
          title: `🔍 Track Stats: "${name}" — ${year}`,
          fields,
          footer: { text: 'Showing top matches' },
        }],
      });
    }
  },
};

module.exports = { wrappedCommand, statsCommand };
