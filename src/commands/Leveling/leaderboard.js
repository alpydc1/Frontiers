import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getLeaderboard, getLevelingConfig, getXpForLevel } from '../../services/leveling.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

function formatNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function getLevelBadge(level) {
  if (level >= 100) return '👑';
  if (level >= 75)  return '💎';
  if (level >= 50)  return '🔥';
  if (level >= 25)  return '⚡';
  if (level >= 10)  return '🌟';
  return '🌱';
}

function createMiniBar(current, max, length = 8) {
  const pct = max > 0 ? Math.min(current / max, 1) : 0;
  const filled = Math.round(pct * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription("Shows the server's level leaderboard")
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

      const leaderboard = await getLeaderboard(client, interaction.guildId, 10);

      if (leaderboard.length === 0) {
        throw new TitanBotError(
          'No leaderboard data found',
          ErrorTypes.DATABASE,
          'No one has earned XP yet. Start chatting to appear on the leaderboard!',
        );
      }

      // ── Podium (top 3) ──────────────────────────────────────────
      const podiumEmojis = ['🥇', '🥈', '🥉'];
      const podiumLines = await Promise.all(
        leaderboard.slice(0, 3).map(async (user, i) => {
          const member = await interaction.guild.members.fetch(user.userId).catch(() => null);
          const name = member?.displayName ?? user.username ?? `<@${user.userId}>`;
          const badge = getLevelBadge(user.level);
          const xpNeeded = getXpForLevel(user.level + 1);
          const bar = createMiniBar(user.xp, xpNeeded);
          return (
            `${podiumEmojis[i]} **${name}** ${badge}\n` +
            `> Level **${user.level}** · ${formatNum(user.totalXp)} XP · \`${bar}\``
          );
        }),
      );

      // ── Ranks 4–10 ──────────────────────────────────────────────
      const restLines = await Promise.all(
        leaderboard.slice(3).map(async (user, i) => {
          const member = await interaction.guild.members.fetch(user.userId).catch(() => null);
          const name = member?.displayName ?? user.username ?? `<@${user.userId}>`;
          const badge = getLevelBadge(user.level);
          return (
            `**${i + 4}.** ${badge} ${name} — Level **${user.level}** · ${formatNum(user.totalXp)} XP`
          );
        }),
      );

      // ── Requester's position ─────────────────────────────────────
      const selfPos = leaderboard.findIndex((u) => u.userId === interaction.user.id);
      const footerText =
        selfPos !== -1
          ? `You are ranked #${selfPos + 1} on this server · ${interaction.guild.name}`
          : `You haven't earned XP yet · ${interaction.guild.name}`;

      const embed = new EmbedBuilder()
        .setColor('#F4D03F')
        .setTitle(`🏆 ${interaction.guild.name} Leaderboard`)
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }) ?? null)
        .addFields(
          {
            name: '━━━ Top 3 ━━━',
            value: podiumLines.join('\n\n') || 'No data',
          },
        );

      if (restLines.length > 0) {
        embed.addFields({
          name: '━━━ Rankings ━━━',
          value: restLines.join('\n'),
        });
      }

      embed
        .setFooter({
          text: footerText,
          iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
        })
        .setTimestamp();

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      logger.debug(`Leaderboard fetched for guild ${interaction.guildId}`);
    } catch (error) {
      logger.error('Leaderboard command error:', error);
      await handleInteractionError(interaction, error, {
        type: 'command',
        commandName: 'leaderboard',
      });
    }
  },
};
