import { WarningService } from "../services/warningService.js";
import { createEmbed } from "../utils/embeds.js";

export default {
    // Changed 'id' to 'name' to ensure client.buttons.get("remove_warn") works
    name: "remove_warn",

    async execute(interaction, client, args) {
        // Ensure args exist to prevent "undefined" crashes
        if (!args || args.length < 2) {
            return interaction.reply({
                content: "❌ Interaction data is missing. Please try again.",
                ephemeral: true
            });
        }

        const [userId, warningId] = args;

        try {
            // We await the service call. Ensure your WarningService returns 
            // an object with { success: true/false }
            const result = await WarningService.removeWarning(
                interaction.guild.id,
                userId,
                Number(warningId)
            );

            if (!result || !result.success) {
                return interaction.reply({
                    embeds: [
                        createEmbed({
                            title: "❌ Error",
                            description: result?.error || "Could not find that warning in the database.",
                            color: "danger"
                        })
                    ],
                    ephemeral: true
                });
            }

            // interaction.update is used so the original message changes 
            // instead of sending a brand new reply.
            return interaction.update({
                embeds: [
                    createEmbed({
                        title: "✅ Warning Removed",
                        description: `Warning **#${warningId}** has been successfully cleared for <@${userId}>.`,
                        color: "success"
                    })
                ],
                components: [] // This clears the buttons so they can't be clicked again
            });

        } catch (error) {
            console.error("Button Execution Error:", error);
            return interaction.reply({
                content: "❌ An internal database error occurred while removing the warning.",
                ephemeral: true
            });
        }
    }
};
