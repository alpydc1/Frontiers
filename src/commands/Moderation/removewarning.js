import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { WarningService } from '../../services/warningService.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName('removewarning')
    .setDescription('Remove a specific warning from a user')
    .addUserOption((option) =>
      option.setName('user').setDescription('User to remove warning from').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('id')
        .setDescription('Warning ID (shown in /warnings)')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  category: 'moderation',

  async execute(interaction) {
    try {
      const user = interaction.options.getUser('user');
      const rawId = interaction.options.getString('id');
      const warningId = Number(rawId);

      if (isNaN(warningId)) {
        return interaction.reply({
          embeds: [
            createEmbed({
              title: '❌ Invalid ID',
              description: 'Please provide a valid warning ID. You can find IDs using `/warnings`.',
              color: 'danger',
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      const result = await WarningService.removeWarning(
        interaction.guild.id,
        user.id,
        warningId,
      );

      if (!result.success) {
        return interaction.reply({
          embeds: [
            createEmbed({
              title: '❌ Failed',
              description: result.error,
              color: 'danger',
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        embeds: [
          createEmbed({
            title: '✅ Warning Removed',
            description: `Removed warning \`${warningId}\` from ${user}.`,
            color: 'success',
          }),
        ],
      });
    } catch (error) {
      logger.error('Removewarning command error:', error);
      await handleInteractionError(interaction, error, { subtype: 'removewarning_failed' });
    }
  },
};
