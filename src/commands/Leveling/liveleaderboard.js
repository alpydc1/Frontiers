import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
  getLiveLeaderboardConfig,
  setLiveLeaderboardConfig,
  buildLeaderboardEmbed,
} from '../../services/liveLeaderboard.js';

export default {
  data: new SlashCommandBuilder()
    .setName('liveleaderboard')
    .setDescription('Set up a live auto-updating leaderboard in a channel')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Choose a channel to post the live leaderboard in')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('The text channel for the leaderboard')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('disable').setDescription('Stop the live leaderboard updates')
    ),
  category: 'Leveling',

  async execute(interaction, config, client) {
    try {
      await InteractionHelper.safeDefer(interaction, { ephemeral: true });

      const sub = interaction.options.getSubcommand();

      if (sub === 'set') {
        const channel = interaction.options.getChannel('channel');

        const embed = await buildLeaderboardEmbed(client, interaction.guild);
        const message = await channel.send({ embeds: [embed] });

        await setLiveLeaderboardConfig(client, interaction.guildId, {
          channelId: channel.id,
          messageId: message.id,
        });

        await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            new EmbedBuilder()
              .setColor('#2ECC71')
              .setTitle('✅ Live Leaderboard Activated')
              .setDescription(
                `The leaderboard has been posted in ${channel} and will automatically update every **5 minutes**.\n\n` +
                `It tracks:\n` +
                `⭐ **XP / Level** — earned by chatting\n` +
                `💬 **Message Count** — total messages sent`
              ),
          ],
        });
      } else if (sub === 'disable') {
        const existing = await getLiveLeaderboardConfig(client, interaction.guildId);
        if (!existing) {
          return await InteractionHelper.safeEditReply(interaction, {
            embeds: [
              new EmbedBuilder()
                .setColor('#E74C3C')
                .setDescription('❌ No live leaderboard is currently set up.'),
            ],
          });
        }

        await setLiveLeaderboardConfig(client, interaction.guildId, null);

        await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            new EmbedBuilder()
              .setColor('#2ECC71')
              .setDescription('✅ Live leaderboard has been disabled.'),
          ],
        });
      }
    } catch (error) {
      logger.error('Live leaderboard command error:', error);
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor('#E74C3C')
            .setDescription('❌ Something went wrong. Please try again.'),
        ],
      });
    }
  },
};
