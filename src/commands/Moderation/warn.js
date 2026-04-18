import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { WarningService } from '../../services/warningService.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View and manage warnings for a user')
    .addUserOption((option) =>
      option.setName('user').setDescription('User to check').setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  category: 'moderation',

  async execute(interaction) {
    try {
      const user = interaction.options.getUser('user');
      const warnings = await WarningService.getWarnings(interaction.guild.id, user.id);

      if (!warnings.length) {
        return interaction.reply({
          embeds: [
            createEmbed({
              title: '📜 No Warnings',
              description: `${user} has a clean record.`,
              color: 'success',
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = createEmbed({
        title: `⚠️ Warnings for ${user.username}`,
        description: `**${user}** has **${warnings.length}** active warning(s). Click a button below to remove one.`,
        color: 'warning',
        footer: warnings.length > 5 ? `Showing 5 of ${warnings.length} warnings` : null,
      });

      const rows = [];

      warnings.slice(0, 5).forEach((w, index) => {
        const date = new Date(w.timestamp || w.createdAt || Date.now());
        const timestamp = Math.floor(date.getTime() / 1000);

        embed.addFields({
          name: `Warning ${index + 1} — ID: \`${w.id}\``,
          value:
            `**Reason:** ${w.reason}\n` +
            `**Moderator:** <@${w.moderatorId}>\n` +
            `**Date:** <t:${timestamp}:R>`,
          inline: false,
        });

        rows.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`remove_warn:${user.id}:${w.id}`)
              .setLabel(`Remove Warning ${index + 1}`)
              .setStyle(ButtonStyle.Danger),
          ),
        );
      });

      return interaction.reply({
        embeds: [embed],
        components: rows,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error('Warnings command error:', error);
      await handleInteractionError(interaction, error, { subtype: 'warnings_fetch_failed' });
    }
  },
};
