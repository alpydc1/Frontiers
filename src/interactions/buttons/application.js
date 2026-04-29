// ============================================================
// src/interactions/buttons/application.js
// Add this file — handles Approve/Deny buttons on log channel embeds.
// Staff click these directly without running any slash command.
// ============================================================

import {
    EmbedBuilder,
    ModalBuilder,
    ActionRowBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import ApplicationService from '../../services/applicationService.js';
import { getApplication } from '../../utils/database.js';

// ─── Shared helper ─────────────────────────────────────────────────────────

function statusDisplay(status) {
    const s = typeof status === 'string' ? status.trim().toLowerCase() : 'unknown';
    return {
        label: { pending: 'In Progress', approved: 'Accepted', denied: 'Denied' }[s] ?? 'Unknown',
        emoji: { pending: '🟡', approved: '🟢', denied: '🔴' }[s] ?? '⚪',
    };
}

// ─── Core handler ──────────────────────────────────────────────────────────

async function handleReview(interaction, isApprove) {
    // Button customId format:  app_approve:applicationId  /  app_deny:applicationId
    const appId = interaction.customId.split(':')[1];

    if (!appId) {
        return interaction.reply({
            embeds: [errorEmbed('Malformed button — application ID missing.')],
            flags: ['Ephemeral'],
        });
    }

    // ── Permission check ────────────────────────────────────────────────────
    try {
        await ApplicationService.checkManagerPermission(
            interaction.client,
            interaction.guild.id,
            interaction.member,
        );
    } catch {
        return interaction.reply({
            embeds: [
                errorEmbed(
                    'No Permission',
                    'You need the **Manage Server** permission or a configured manager role to review applications.',
                ),
            ],
            flags: ['Ephemeral'],
        });
    }

    // ── Load application ────────────────────────────────────────────────────
    const application = await getApplication(interaction.client, interaction.guild.id, appId);

    if (!application) {
        return interaction.reply({
            embeds: [errorEmbed('Application not found. It may have been deleted.')],
            flags: ['Ephemeral'],
        });
    }

    if (application.status !== 'pending') {
        const { emoji, label } = statusDisplay(application.status);
        return interaction.reply({
            embeds: [
                errorEmbed(
                    'Already Reviewed',
                    `This application has already been marked as **${label}** ${emoji}`,
                ),
            ],
            flags: ['Ephemeral'],
        });
    }

    // ── Show reason modal ───────────────────────────────────────────────────
    const action = isApprove ? 'Approve' : 'Deny';
    const modalId = `app_reason:${appId}:${isApprove ? '1' : '0'}`;

    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(`${isApprove ? '✅' : '❌'} ${action} Application`);

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('reason')
                .setLabel(`Reason (optional)`)
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder(
                    isApprove
                        ? 'Welcome message or notes for the applicant...'
                        : 'Why is this application being denied?',
                )
                .setMaxLength(500)
                .setRequired(false),
        ),
    );

    await interaction.showModal(modal);

    // ── Wait for reason ─────────────────────────────────────────────────────
    let reasonSubmit;
    try {
        reasonSubmit = await interaction.awaitModalSubmit({
            time: 5 * 60 * 1000,
            filter: i =>
                i.customId === modalId && i.user.id === interaction.user.id,
        });
    } catch {
        return; // Timed out
    }

    await reasonSubmit.deferReply({ flags: ['Ephemeral'] });

    const reason =
        reasonSubmit.fields.getTextInputValue('reason').trim() || 'No reason provided.';
    const status = isApprove ? 'approved' : 'denied';
    const { emoji, label } = statusDisplay(status);
    const statusColor = isApprove
        ? getColor('success') || '#57F287'
        : getColor('error') || '#ED4245';

    try {
        // ── Process the review ──────────────────────────────────────────────
        await ApplicationService.reviewApplication(
            reasonSubmit.client,
            interaction.guild.id,
            appId,
            { action: isApprove ? 'approve' : 'deny', reason, reviewerId: interaction.user.id },
        );

        // ── Update log channel embed ────────────────────────────────────────
        try {
            const logMsg = await interaction.message.fetch();
            if (logMsg.embeds.length > 0) {
                const old = logMsg.embeds[0];

                // Replace the status field, strip the buttons, add reviewer note
                const fields = old.fields.map(f => {
                    if (f.name === '📊 Status') {
                        return { name: '📊 Status', value: `${emoji} ${label}`, inline: true };
                    }
                    return f;
                });

                // Append reviewer note at end
                fields.push({
                    name: `${isApprove ? '✅' : '❌'} Decision`,
                    value: `Reviewed by <@${interaction.user.id}>\n> ${reason}`,
                    inline: false,
                });

                const updatedEmbed = EmbedBuilder.from(old)
                    .setColor(statusColor)
                    .setFields(fields)
                    .setFooter({ text: `Reviewed by ${interaction.user.tag}` })
                    .setTimestamp();

                await logMsg.edit({ embeds: [updatedEmbed], components: [] });
            }
        } catch (err) {
            logger.warn('Could not update log embed', { error: err.message });
        }

        // ── Assign role if approved ─────────────────────────────────────────
        if (isApprove) {
            try {
                const member = await interaction.guild.members.fetch(application.userId);
                await member.roles.add(application.roleId);
            } catch (err) {
                logger.error('Failed to assign role on approval', {
                    error: err.message,
                    userId: application.userId,
                    roleId: application.roleId,
                });
            }
        }

        // ── DM the applicant ────────────────────────────────────────────────
        try {
            const user = await interaction.client.users.fetch(application.userId);
            const dmEmbed = new EmbedBuilder()
                .setTitle(`${emoji} Application ${label}`)
                .setDescription(
                    `Your application for **${application.roleName}** has been **${status}**.\n\n` +
                        `**Note from staff:** ${reason}`,
                )
                .setColor(statusColor)
                .setTimestamp();

            if (isApprove) {
                dmEmbed.addFields({
                    name: '🎉 Next Steps',
                    value: `You've been given the role in **${interaction.guild.name}**. Welcome!`,
                    inline: false,
                });
            }

            await user.send({ embeds: [dmEmbed] });
        } catch {
            logger.warn('Could not DM applicant', { userId: application.userId });
        }

        // ── Confirm to reviewer ─────────────────────────────────────────────
        await reasonSubmit.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(`${emoji} Application ${label}`)
                    .setDescription(
                        `You have **${status}** the application from <@${application.userId}> for **${application.roleName}**.\n\n` +
                            `**Reason:** ${reason}`,
                    )
                    .setColor(statusColor),
            ],
        });
    } catch (err) {
        logger.error('Error processing application review', {
            error: err.message,
            appId,
            guildId: interaction.guild.id,
            stack: err.stack,
        });

        await reasonSubmit.editReply({
            embeds: [
                errorEmbed(
                    'Review Failed',
                    'An error occurred while processing this review. Please try again.',
                ),
            ],
        });
    }
}

// ─── Exports ───────────────────────────────────────────────────────────────

export default [
    {
        name: 'app_approve',
        execute: interaction => handleReview(interaction, true),
    },
    {
        name: 'app_deny',
        execute: interaction => handleReview(interaction, false),
    },
];
