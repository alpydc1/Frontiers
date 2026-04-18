import { WarningService } from "../services/warningService.js";
import { createEmbed } from "../utils/embeds.js";

export default {
    /**
     * The 'name' must match the first part of your customId (remove_warn)
     * so that client.buttons.get("remove_warn") works in interactionCreate.js
     */
    name: "remove_warn",

    async execute(interaction, client, args) {
        // 1. Validation: Ensure we have [userId, warningId]
        if (!args || args.length < 2) {
            return interaction.reply({
                content: "❌ Failed to process: Missing interaction data.",
                ephemeral: true
            });
        }

        const userId = args[0];
        // 2. Critical Fix: Convert the string ID from the button to a Number
        // Your WarningService uses Date.now() for IDs, which are Numbers.
        const warningId = Number(args[1]);

        if (isNaN(warningId)) {
            return interaction.reply({
                content: "❌ Invalid Warning ID provided.",
                ephemeral: true
            });
        }

        try {
            // 3. Perform the deletion via Service
            const result = await WarningService.removeWarning(
                interaction.guild.id,
                userId,
                warningId
            );

            // 4. Handle Service-level errors (e.g., Warning not found)
            if (!result || !result.success) {
                return interaction.reply({
                    embeds: [
                        createEmbed({
                            title: "❌ Error",
                            description: result?.error || "This warning no longer exists in our records.",
                            color: "danger"
                        })
                    ],
                    ephemeral: true
                });
            }

            /**
             * 5. Success UI: Use interaction.update to modify the existing message.
             * This removes the buttons and replaces the warning list with a success embed.
             */
            return interaction.update({
                embeds: [
                    createEmbed({
                        title: "✅ Warning Removed",
                        description: `The warning has been successfully cleared for <@${userId}>.`,
                        color: "success"
                    })
                ],
                components: [] // Crucial: Removes the buttons to prevent re-clicks
            });

        } catch (error) {
            /**
             * If the code hits this block, it means there's a real crash (SQL/Connection).
             * We log it to your terminal so you can see the actual error.
             */
            console.error(`[Button Error: remove_warn] Trace: ${interaction.traceId}`, error);
            
            return interaction.reply({
                content: "❌ A system error occurred. Our developers have been notified.",
                ephemeral: true
            });
        }
    }
};
