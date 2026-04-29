// ============================================================
// src/interactions/buttons/application.js
// Handles Approve / Deny / Hold / Note buttons on log embeds.
// Staff click these directly — no slash command needed.
// ============================================================

import {
    EmbedBuilder,
    ModalBuilder,
    ActionRowBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';
import {
    getApplication,
    updateApplication,
    getApplicationSettings,
} from '../../utils/database.js';
import { statusDisplay, buildLogButtons } from '../../commands/Community/application.js';

// ─── helpers ───────────────────────────────────────────────────────────────

function errorEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`❌ ${title}`)
        .setDescription(description ?? title)
        .setColor(getColor('error') || '#ED4245');
}

async function assertManager(interaction) {
    if (interaction.member.permissions.has('ManageGuild')) return;
    const settings = await getApplicationSettings(interaction.client, interaction.guild.id);
    const hasRole = settings.managerRoles?.some(roleId => interaction.member.roles.cache.has(roleId));
    if (!hasRole) throw new Error('no permission');
}

async function loadPendingApp(interaction, appId) {
    const app = await getApplication(interaction.client, interaction.guild.id, appId);

    if (!app) {
        await interaction.reply({
            embeds: [errorEmbed('Not Found', 'Application not found — it may have been deleted.')],
            flags: ['Ephemeral'],
        });
        return null;
    }

    return app;
}

// ─── Approve / Deny ────────────────────────────────────────────────────────

async function handleReview(interaction, isApprove) {
    const appId = interaction.customId.split(':')[1];

    if (!appId) {
        return interaction.reply({
            embeds: [errorEmbed('Malformed Button', 'Application ID is missing from this button.')],
            flags: ['Ephemeral'],
        });
    }

    // Permission check
    try {
        await assertManager(interaction);
    } catch {
        return interaction.reply({
            embeds: [errorEmbed(
                'No Permission',
                'You need the **Manage Server** permission or a configured manager role to review applications.',
            )],
            flags: ['Ephemeral'],
        });
    }

    // Load application
    const app = await loadPendingApp(interaction, appId);
    if (!app) return;

    // Check status
    if (app.status !== 'pending' && app.status !== 'on_hold') {
        const { emoji, label } = statusDisplay(app.status);
        return interaction.reply({
            embeds: [errorEmbed(
                'Already Reviewed',
                `This application has already been marked **${label}** ${emoji}`,
            )],
            flags: ['Ephemeral'],
        });
    }

    // Show reason modal
    const action = isApprove ? 'Approve' : 'Deny';
    const modalId = `appreason_${appId}_${isApprove ? '1' : '0'}`;

    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(`${isApprove ? '✅' : '❌'} ${action} Application`);

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('reason')
                .setLabel('Reason (optional)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder(
                    isApprove
                        ? 'Welcome message or any notes for the applicant...'
                        : 'Why is this application being denied?',
                )
                .setMaxLength(500)
                .setRequired(false),
        ),
    );

    await interaction.showModal(modal);

    // Wait for modal
    let submit;
    try {
        submit = await interaction.awaitModalSubmit({
            time: 5 * 60_000,
            filter: i => i.customId === modalId && i.user.id === interaction.user.id,
        });
    } catch {
        return; // timed out — no response needed
    }

    await submit.deferReply({ flags: ['Ephemeral'] });

    const reason = submit.fields.getTextInputValue('reason').trim() || 'No reason provided.';
    const status = isApprove ? 'approved' : 'denied';
    const { emoji, label, color } = statusDisplay(status);

    try {
        // Process the review
        await updateApplication(
            submit.client,
            interaction.guild.id,
            appId,
            {
                status,
                reviewMessage: reason,
                reviewerId: interaction.user.id,
                reviewedAt: new Date().toISOString(),
            },
        );

        // Update log embed
        try {
            const logMsg = await interaction.message.fetch();
            if (logMsg.embeds.length > 0) {
                const old = logMsg.embeds[0];

                const fields = old.fields.map(f =>
                    f.name === '📊 Status'
                        ? { name: '📊 Status', value: `${emoji} ${label}`, inline: true }
                        : f,
                );

                fields.push({
                    name: `${isApprove ? '✅' : '❌'} Decision`,
                    value: `Reviewed by <@${interaction.user.id}>\n> ${reason}`,
                    inline: false,
                });

                const updatedEmbed = EmbedBuilder.from(old)
                    .setColor(color)
                    .setFields(fields)
                    .setFooter({ text: `Reviewed by ${interaction.user.tag}` })
                    .setTimestamp();

                // Buttons are removed (null = no components)
                await logMsg.edit({ embeds: [updatedEmbed], components: [] });
            }
        } catch (err) {
            logger.warn('Could not update log embed after review', { error: err.message });
        }

        // Assign role if approved
        if (isApprove && app.roleId) {
            try {
                const member = await interaction.guild.members.fetch(app.userId);
                await member.roles.add(app.roleId);
            } catch (err) {
                logger.error('Failed to assign role on approval', {
                    error: err.message,
                    userId: app.userId,
                    roleId: app.roleId,
                });
            }
        }

        // DM the applicant
        try {
            const user = await interaction.client.users.fetch(app.userId);
            const dmEmbed = new EmbedBuilder()
                .setTitle(`${emoji} Application ${label}`)
                .setDescription(
                    `Your application for **${app.roleName}** has been **${status}**.\n\n` +
                    `**Note from staff:** ${reason}`,
                )
                .setColor(color)
                .setTimestamp();

            if (isApprove) {
                dmEmbed.addFields({
                    name: '🎉 Next Steps',
                    value: `You've been granted the role in **${interaction.guild.name}**. Welcome!`,
                    inline: false,
                });
            }

            await user.send({ embeds: [dmEmbed] });
        } catch {
            logger.warn('Could not DM applicant', { userId: app.userId });
        }

        // Confirm to reviewer
        await submit.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(`${emoji} Application ${label}`)
                    .setDescription(
                        `You have **${status}** the application from <@${app.userId}> for **${app.roleName}**.\n\n` +
                        `**Reason:** ${reason}`,
                    )
                    .setColor(color),
            ],
        });
    } catch (err) {
        logger.error('Error processing application review', {
            error: err.message,
            appId,
            guildId: interaction.guild.id,
            stack: err.stack,
        });

        await submit.editReply({
            embeds: [errorEmbed('Review Failed', 'Something went wrong. Please try again.')],
        });
    }
}

// ─── Hold / Remove Hold ────────────────────────────────────────────────────

async function handleHold(interaction) {
    const appId = interaction.customId.split(':')[1];

    if (!appId) {
        return interaction.reply({
            embeds: [errorEmbed('Malformed Button', 'Application ID is missing.')],
            flags: ['Ephemeral'],
        });
    }

    try {
        await assertManager(interaction);
    } catch {
        return interaction.reply({
            embeds: [errorEmbed(
                'No Permission',
                'You need the **Manage Server** permission or a configured manager role.',
            )],
            flags: ['Ephemeral'],
        });
    }

    const app = await loadPendingApp(interaction, appId);
    if (!app) return;

    if (app.status !== 'pending' && app.status !== 'on_hold') {
        const { emoji, label } = statusDisplay(app.status);
        return interaction.reply({
            embeds: [errorEmbed(
                'Cannot Hold',
                `This application is already **${label}** ${emoji} and cannot be placed on hold.`,
            )],
            flags: ['Ephemeral'],
        });
    }

    const isRemoving = app.status === 'on_hold';
    const newStatus = isRemoving ? 'pending' : 'on_hold';
    const { emoji, label, color } = statusDisplay(newStatus);

    try {
        await updateApplication(interaction.client, interaction.guild.id, appId, {
            status: newStatus,
            holdBy: isRemoving ? null : interaction.user.id,
            holdAt: isRemoving ? null : Date.now(),
        });

        // Update log embed
        try {
            const logMsg = await interaction.message.fetch();
            if (logMsg.embeds.length > 0) {
                const old = logMsg.embeds[0];

                const fields = old.fields.map(f =>
                    f.name === '📊 Status'
                        ? { name: '📊 Status', value: `${emoji} ${label}`, inline: true }
                        : f,
                );

                const updatedEmbed = EmbedBuilder.from(old)
                    .setColor(color)
                    .setFields(fields)
                    .setFooter({
                        text: isRemoving
                            ? `Hold removed by ${interaction.user.tag}`
                            : `Placed on hold by ${interaction.user.tag}`,
                    })
                    .setTimestamp();

                // Rebuild buttons with updated status
                const newButtons = buildLogButtons(appId, newStatus);
                await logMsg.edit({
                    embeds: [updatedEmbed],
                    components: newButtons ? [newButtons] : [],
                });
            }
        } catch (err) {
            logger.warn('Could not update log embed after hold toggle', { error: err.message });
        }

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setDescription(
                        isRemoving
                            ? `⏸️ Hold removed — application from <@${app.userId}> is back to **Pending Review**.`
                            : `⏸️ Application from <@${app.userId}> placed **On Hold**.`,
                    )
                    .setColor(color),
            ],
            flags: ['Ephemeral'],
        });
    } catch (err) {
        logger.error('Error toggling application hold', {
            error: err.message,
            appId,
            guildId: interaction.guild.id,
        });

        await interaction.reply({
            embeds: [errorEmbed('Hold Failed', 'Something went wrong. Please try again.')],
            flags: ['Ephemeral'],
        });
    }
}

// ─── Add Note ──────────────────────────────────────────────────────────────

async function handleNote(interaction) {
    const appId = interaction.customId.split(':')[1];

    if (!appId) {
        return interaction.reply({
            embeds: [errorEmbed('Malformed Button', 'Application ID is missing.')],
            flags: ['Ephemeral'],
        });
    }

    try {
        await assertManager(interaction);
    } catch {
        return interaction.reply({
            embeds: [errorEmbed(
                'No Permission',
                'You need the **Manage Server** permission or a configured manager role.',
            )],
            flags: ['Ephemeral'],
        });
    }

    const app = await loadPendingApp(interaction, appId);
    if (!app) return;

    // Show note modal
    const modalId = `appnote_${appId}`;

    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('📝 Add Staff Note');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('note')
                .setLabel('Note')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Internal staff note — not visible to the applicant.')
                .setMaxLength(500)
                .setRequired(true),
        ),
    );

    await interaction.showModal(modal);

    let submit;
    try {
        submit = await interaction.awaitModalSubmit({
            time: 5 * 60_000,
            filter: i => i.customId === modalId && i.user.id === interaction.user.id,
        });
    } catch {
        return;
    }

    await submit.deferReply({ flags: ['Ephemeral'] });

    const noteText = submit.fields.getTextInputValue('note').trim();

    try {
        const notes = Array.isArray(app.notes) ? app.notes : [];
        const newNote = {
            text: noteText,
            authorId: interaction.user.id,
            authorTag: interaction.user.tag,
            timestamp: Date.now(),
        };
        notes.push(newNote);

        await updateApplication(interaction.client, interaction.guild.id, appId, { notes });

        // Update log embed footer to show note count
        try {
            const logMsg = await interaction.message.fetch();
            if (logMsg.embeds.length > 0) {
                const old = logMsg.embeds[0];
                const updatedEmbed = EmbedBuilder.from(old)
                    .setFooter({ text: `📝 ${notes.length} staff note${notes.length === 1 ? '' : 's'}` })
                    .setTimestamp();

                await logMsg.edit({ embeds: [updatedEmbed] });
            }
        } catch (err) {
            logger.warn('Could not update log embed after note', { error: err.message });
        }

        await submit.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('📝 Note Added')
                    .setDescription(`Your note has been saved to this application.\n\n> ${noteText}`)
                    .setColor(getColor('primary') || '#5865F2')
                    .setFooter({ text: `${notes.length} total note${notes.length === 1 ? '' : 's'} on this application` }),
            ],
        });
    } catch (err) {
        logger.error('Error saving application note', {
            error: err.message,
            appId,
            guildId: interaction.guild.id,
        });

        await submit.editReply({
            embeds: [errorEmbed('Save Failed', 'Could not save the note. Please try again.')],
        });
    }
}

// ─── Exports ───────────────────────────────────────────────────────────────

export default [
    { name: 'app_approve', execute: interaction => handleReview(interaction, true)  },
    { name: 'app_deny',    execute: interaction => handleReview(interaction, false) },
    { name: 'app_hold',    execute: handleHold },
    { name: 'app_note',    execute: handleNote },
];
