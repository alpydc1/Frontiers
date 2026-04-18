import { WarningService } from "../services/warningService.js";
import { createEmbed } from "../utils/embeds.js";

export default {
  id: "remove_warn",

  async execute(interaction, client, args) {
    const [userId, warningId] = args;

    const result = await WarningService.removeWarning(
      interaction.guild.id,
      userId,
      Number(warningId)
    );

    if (!result.success) {
      return interaction.reply({
        embeds: [
          createEmbed({
            title: "❌ Error",
            description: result.error,
            color: "danger"
          })
        ],
        ephemeral: true
      });
    }

    return interaction.update({
      embeds: [
        createEmbed({
          title: "✅ Warning Removed",
          description: "The warning has been removed.",
          color: "success"
        })
      ],
      components: []
    });
  }
};
