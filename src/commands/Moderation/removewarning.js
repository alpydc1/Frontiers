import { SlashCommandBuilder } from "discord.js";
import { WarningService } from "../../services/warningService.js";
import { createEmbed } from "../../utils/embeds.js";

export default {
  data: new SlashCommandBuilder()
    .setName("removewarning")
    .setDescription("Remove a specific warning from a user")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("User to remove warning from")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("id")
        .setDescription("Warning ID")
        .setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("user");
    const warningId = Number(interaction.options.getString("id"));

    const result = await WarningService.removeWarning(
      interaction.guild.id,
      user.id,
      warningId
    );

    if (!result.success) {
      return interaction.reply({
        embeds: [
          createEmbed({
            title: "❌ Failed",
            description: result.error,
            color: "danger"
          })
        ],
        ephemeral: true
      });
    }

    return interaction.reply({
      embeds: [
        createEmbed({
          title: "✅ Warning Removed",
          description: `Removed warning **${warningId}** from ${user}`,
          color: "success"
        })
      ]
    });
  }
};
