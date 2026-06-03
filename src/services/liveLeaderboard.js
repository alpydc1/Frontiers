import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLeaderboard, getXpForLevel } from './leveling.js';

function formatNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function getLevelBadge(level) {
  if (level >= 100) return '👑';
  if (level >= 75) return '💎';
  if (level >= 50) return '🔥';
  if (level >= 25) return '⚡';
  if (level >= 10) return '🌟';
  return '🌱';
}

function getRankMedal(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `**${rank}.**`;
}

export async function incrementMessageCount(client, guildId, userId) {
  try {
    const key = `${guildId}:msgcount:${userId}`;
    const data = (await client.db.get(key)) || { count: 0 };
    data.count = (data.count || 0) + 1;
    await client.db.set(key, data);
  } catch (error) {
    logger.warn(`Failed to increment message count for ${userId}:`, error.message);
  }
}

export async function getMessageCount(client, guildId, userId) {
  try {
    const key = `${guildId}:msgcount:${userId}`;
    const data = await client.db.get(key);
    return data?.count || 0;
  } catch {
    return 0;
  }
}

async function getMessageLeaderboard(client, guildId, limit = 10) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return [];

  const members = await guild.members.fetch().catch(() => new Map());
  const results = [];

  for (const [userId, member] of members) {
    if (member.user.bot) continue;
    const count = await getMessageCount(client, guildId, userId);
    if (count > 0) {
      results.push({ userId, displayName: member.displayName, count });
    }
  }

  results.sort((a, b) => b.count - a.count);
  return results.slice(0, limit);
}

export async function buildLeaderboardEmbed(client, guild) {
  const guildId = guild.id;

  const [xpBoard, msgBoard] = await Promise.all([
    getLeaderboard(client, guildId, 10).catch(() => []),
    getMessageLeaderboard(client, guildId, 10).catch(() => []),
  ]);

  const embed = new EmbedBuilder()
    .setColor('#F4D03F')
    .setTitle(`🏆 ${guild.name} — Live Leaderboard`)
    .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
    .setTimestamp()
    .setFooter({ text: `Auto-updates every 5 minutes · ${guild.name}` });

  if (xpBoard.length > 0) {
    const xpLines = await Promise.all(
      xpBoard.map(async (user, i) => {
        const member = await guild.members.fetch(user.userId).catch(() => null);
        const name = member?.displayName ?? user.username ?? `<@${user.userId}>`;
        const badge = getLevelBadge(user.level);
        return `${getRankMedal(i + 1)} ${badge} **${name}** — Lv.**${user.level}** · ${formatNum(user.totalXp)} XP`;
      })
    );
    embed.addFields({ name: '⭐ XP / Level Rankings', value: xpLines.join('\n') });
  } else {
    embed.addFields({ name: '⭐ XP / Level Rankings', value: '_No XP earned yet. Start chatting!_' });
  }

  if (msgBoard.length > 0) {
    const msgLines = msgBoard.map((user, i) =>
      `${getRankMedal(i + 1)} **${user.displayName}** — ${formatNum(user.count)} messages`
    );
    embed.addFields({ name: '💬 Message Count Rankings', value: msgLines.join('\n') });
  } else {
    embed.addFields({ name: '💬 Message Count Rankings', value: '_No messages tracked yet._' });
  }

  return embed;
}

export async function getLiveLeaderboardConfig(client, guildId) {
  try {
    const key = `${guildId}:liveleaderboard:config`;
    return (await client.db.get(key)) || null;
  } catch {
    return null;
  }
}

export async function setLiveLeaderboardConfig(client, guildId, config) {
  const key = `${guildId}:liveleaderboard:config`;
  if (config === null) {
    await client.db.delete(key).catch(() => client.db.set(key, null));
  } else {
    await client.db.set(key, config);
  }
}

export async function updateLiveLeaderboard(client, guildId) {
  try {
    const config = await getLiveLeaderboardConfig(client, guildId);
    if (!config?.channelId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(config.channelId);
    if (!channel) return;

    const embed = await buildLeaderboardEmbed(client, guild);

    if (config.messageId) {
      try {
        const msg = await channel.messages.fetch(config.messageId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch {
        // Message deleted — fall through to post a new one
      }
    }

    const newMsg = await channel.send({ embeds: [embed] });
    config.messageId = newMsg.id;
    await setLiveLeaderboardConfig(client, guildId, config);
  } catch (error) {
    logger.error(`Error updating live leaderboard for guild ${guildId}:`, error);
  }
}

export async function updateAllLiveLeaderboards(client) {
  for (const [guildId] of client.guilds.cache) {
    await updateLiveLeaderboard(client, guildId);
  }
}
