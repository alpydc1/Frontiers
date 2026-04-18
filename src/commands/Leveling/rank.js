import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getUserLevelData, getLevelingConfig, getXpForLevel, getLeaderboard } from '../../services/leveling.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// Color tier based on level
function getLevelColor(level) {
  if (level >= 100) return '#F4D03F'; // Gold
  if (level >= 75)  return '#A569BD'; // Purple
  if (level >= 50)  return '#5DADE2'; // Blue
  if (level >= 25)  return '#48C9B0'; // Teal
  if (level >= 10)  return '#58D68D'; // Green
  return '#BDC3C7';                   // Silver (beginner)
}

// Level badge based on tier
function getLevelBadge(level) {
  if (level >= 100) return '👑';
  if (level >= 75)  return '💎';
  if (level >= 50)  return '🔥';
  if (level >= 25)  return '⚡';
  if (level >= 10)  return '🌟';
  return '🌱';
}

// Tier label
function getTierLabel(level) {
  if (level >= 100) return 'Legendary';
  if (level >= 75)  return 'Diamond';
  if (level >= 50)  return 'Platinum';
  if (level >= 25)  return 'Gold';
  if (level >= 10)  return 'Silver';
  return 'Bronze';
}

// Smooth progress bar with percentage
function createProgressBar(current, max, length = 14) {
  const pct = max > 0 ? Math.min(current / max, 1) : 0;
  const filled = Math.round(pct * length);
  const empty = length - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percent = Math.floor(pct * 100);
  return `\`${bar}\` **${percent}%**`;
}

// Format large numbers nicely
function formatNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export default {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription("Check your or another user's rank and level")
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user to check the rank of')
        .setRequired(false),
    )
    .setDMPermission(false),
  category: 'Leveling',

  async execute(interaction, config, client) {
    try {
      await InteractionHelper.safeDefer(interaction);

      const levelingConfig = await getLevelingConfig(client, interaction.guildId);
      if (!levelingConfig?.enabled) {
        await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            new EmbedBuilder()
              .setColor('#BDC3C7')
              .setDescription('⚙️ The leveling system is currently disabled on this server.'),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const targetUser = interaction.options.getUser('user') || interaction.user;
      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

      if (!member) {
        throw new TitanBotError(
          `User ${targetUser.id} not found in guild`,
          ErrorTypes.USER_INPUT,
          'Could not find that user in this server.',
        );
      }

      const userData = await getUserLevelData(client, interaction.guildId, targetUser.id);
      const safeData = {
        level: userData?.level ?? 0,
        xp: userData?.xp ?? 0,
        totalXp: userData?.totalXp ?? 0,
      };

      const xpNeeded = getXpForLevel(safeData.level + 1);
      const progressBar = createProgressBar(safeData.xp, xpNeeded);
      const color = getLevelColor(safeData.level);
      const badge = getLevelBadge(safeData.level);
      const tier = getTierLabel(safeData.level);

      // Fetch server rank
      let rankText = '—';
      try {
        const leaderboard = await getLeaderboard(client, interaction.guildId, 100);
        const pos = leaderboard.findIndex((u) => u.userId === targetUser.id);
        if (pos !== -1) rankText = `#${pos + 1} of ${leaderboard.length}`;
      } catch {
        // rank fetch is best-effort
      }

      const isSelf = targetUser.id === interaction.user.id;
      const title = isSelf
        ? `${badge} Your Rank Card`
        : `${badge} ${member.displayName}'s Rank Card`;

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
        .setDescription(
          `> **Tier:** ${tier}\n` +
          `> **Server Rank:** ${rankText}`,
        )
        .addFields(
          {
            name: '🎚️ Level',
            value: `**${safeData.level}**`,
            inline: true,
          },
          {
            name: '⭐ Current XP',
            value: `**${formatNum(safeData.xp)}** / ${formatNum(xpNeeded)}`,
            inline: true,
          },
          {
            name: '✨ Total XP',
            value: `**${formatNum(safeData.totalXp)}**`,
            inline: true,
          },
          {
            name: `Progress to Level ${safeData.level + 1}`,
            value: progressBar,
          },
        )
        .setFooter({
          text: `${interaction.guild.name}`,
          iconURL: interaction.guild.iconURL({ dynamic: true }) ?? undefined,
        })
        .setTimestamp();

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      logger.debug(`Rank checked for user ${targetUser.id} in guild ${interaction.guildId}`);
    } catch (error) {
      logger.error('Rank command error:', error);
      await handleInteractionError(interaction, error, {
        type: 'command',
        commandName: 'rank',
      });
    }
  },
};
