import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";

import { WarningService } from "../../services/warningService.js";
import { createEmbed } from "../../utils/embeds.js";

export default {
  data: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View and manage user warnings")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("User to check")
        .setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("user");

    const warnings = await WarningService.getWarnings(
      interaction.guild.id,
      user.id
    );

    if (!warnings.length) {
      return interaction.reply({
        embeds: [
          createEmbed({
            title: "📜 No Warnings",
            description: `${user} has a clean record.`,
            color: "success"
          })
        ]
      });
    }

    const embed = createEmbed({
      title: `⚠️ Warnings for ${user.username}`,
      description: "Click a button below to remove a warning.",
      color: "primary"
    });

    const rows = [];

    warnings.slice(0, 5).forEach((w, index) => {
      embed.addFields({
        name: `Warning ${index + 1}`,
        value:
          `**Reason:** ${w.reason}\n` +
          `**Moderator:** <@${w.moderatorId}>`,
        inline: false
      });

      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`remove_warn:${user.id}:${w.id}`)
            .setLabel(`Remove #${index + 1}`)
            .setStyle(ButtonStyle.Danger)
        )
      );
    });

    return interaction.reply({
      embeds: [embed],
      components: rows
    });
  }
};
