import { WarningService } from '../../services/warningService.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { MessageFlags } from 'discord.js';

export default {
  // Matches the first segment of customId: "remove_warn:userId:warningId"
  name: 'remove_warn',

  async execute(interaction, client, args) {
    if (!args || args.length < 2) {
      return interaction.reply({
        content: '❌ Failed to process: Missing interaction data.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const userId = args[0];
    const warningId = Number(args[1]);

    if (isNaN(warningId)) {
      return interaction.reply({
        content: '❌ Invalid Warning ID provided.',
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const result = await WarningService.removeWarning(
        interaction.guild.id,
        userId,
        warningId,
      );

      if (!result || !result.success) {
        return interaction.reply({
          embeds: [
            createEmbed({
              title: '❌ Error',
              description: result?.error || 'This warning no longer exists in our records.',
              color: 'danger',
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      logger.info(
        `Warning ${warningId} removed for ${userId} in ${interaction.guild.id} by ${interaction.user.id}`,
      );

      // Disable all buttons on the message so they can't be clicked again
      const disabledRows = interaction.message.components.map((row) => {
        const newRow = row.toJSON();
        newRow.components = newRow.components.map((btn) => ({ ...btn, disabled: true }));
        return newRow;
      });

      return interaction.update({
        embeds: [
          createEmbed({
            title: '✅ Warning Removed',
            description: `Warning \`${warningId}\` has been successfully removed for <@${userId}>.`,
            color: 'success',
          }),
        ],
        components: disabledRows,
      });
    } catch (error) {
      logger.error('remove_warn button error:', error);
      return interaction.reply({
        content: '❌ An unexpected error occurred. Please try again.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
