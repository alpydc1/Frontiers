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

async function loadApp(interaction, appId) {
    const app = await getApplication(interaction.client, interaction.guild.id, appId);
    if (!app) {
        await interaction.reply({ embeds: [errorEmbed('Not Found', 'Application not found — it may have been deleted.')], flags: ['Ephemeral'] });
        return null;
    }
    return app;
}

// ─── Approve / Deny ────────────────────────────────────────────────────────

async function handleReview(interaction, isApprove) {
    const appId = interaction.customId.split(':')[1];
    if (!appId) return interaction.reply({ embeds: [errorEmbed('Malformed Button', 'Application ID missing.')], flags: ['Ephemeral'] });

    try { await assertManager(interaction); }
    catch {
        return interaction.reply({ embeds: [errorEmbed('No Permission', 'You need **Manage Server** or a configured manager role.')], flags: ['Ephemeral'] });
    }

    const app = await loadApp(interaction, appId);
    if (!app) return;

    if (app.status !== 'pending' && app.status !== 'on_hold') {
        const { emoji, label } = statusDisplay(app.status);
        return interaction.reply({ embeds: [errorEmbed('Already Reviewed', `This application is already **${label}** ${emoji}`)], flags: ['Ephemeral'] });
    }

    const modalId = `appreason_${appId}_${isApprove ? '1' : '0'}`;
    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(`${isApprove ? '✅ Approve' : '❌ Deny'} Application`);

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('reason')
                .setLabel('Reason (optional)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder(isApprove ? 'Welcome message or notes for the applicant...' : 'Why is this application being denied?')
                .setMaxLength(500)
                .setRequired(false),
        ),
    );

    await interaction.showModal(modal);

    let submit;
    try {
        submit = await interaction.awaitModalSubmit({ time: 5 * 60_000, filter: i => i.customId === modalId && i.user.id === interaction.user.id });
    } catch { return; }

    await submit.deferReply({ flags: ['Ephemeral'] });

    const reason = submit.fields.getTextInputValue('reason').trim() || 'No reason provided.';
    const status = isApprove ? 'approved' : 'denied';
    const { emoji, label, color } = statusDisplay(status);

    try {
        await updateApplication(submit.client, interaction.guild.id, appId, {
            status,
            reviewMessage: reason,
            reviewerId: interaction.user.id,
            reviewedAt: new Date().toISOString(),
        });

        // Update log embed
        try {
            const logMsg = await interaction.message.fetch();
            if (logMsg.embeds.length > 0) {
                const old = logMsg.embeds[0];
                const fields = old.fields.map(f =>
                    f.name === '📊 Status' ? { name: '📊 Status', value: `${emoji} ${label}`, inline: true } : f,
                );
                fields.push({ name: `${isApprove ? '✅' : '❌'} Decision`, value: `Reviewed by <@${interaction.user.id}>\n> ${reason}`, inline: false });
                await logMsg.edit({
                    embeds: [EmbedBuilder.from(old).setColor(color).setFields(fields).setFooter({ text: `Reviewed by ${interaction.user.tag}` }).setTimestamp()],
                    components: [],
                });
            }
        } catch (err) { logger.warn('Could not update log embed', { error: err.message }); }

        // Assign role if approved
        if (isApprove && app.roleId) {
            try {
                const member = await interaction.guild.members.fetch(app.userId);
                await member.roles.add(app.roleId);
            } catch (err) { logger.error('Failed to assign role', { error: err.message, userId: app.userId }); }
        }

        // DM applicant
        try {
            const user = await interaction.client.users.fetch(app.userId);
            const dmEmbed = new EmbedBuilder()
                .setTitle(`${emoji} Application ${label}`)
                .setDescription(`Your application for **${app.roleName}** has been **${status}**.\n\n**Note from staff:** ${reason}`)
                .setColor(color)
                .setTimestamp();
            if (isApprove) dmEmbed.addFields({ name: '🎉 Next Steps', value: `You've been granted the role in **${interaction.guild.name}**. Welcome!`, inline: false });
            await user.send({ embeds: [dmEmbed] });
        } catch { logger.warn('Could not DM applicant', { userId: app.userId }); }

        await submit.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(`${emoji} Application ${label}`)
                    .setDescription(`You have **${status}** the application from <@${app.userId}> for **${app.roleName}**.\n\n**Reason:** ${reason}`)
                    .setColor(color),
            ],
        });
    } catch (err) {
        logger.error('Error processing review', { error: err.message, appId });
        await submit.editReply({ embeds: [errorEmbed('Review Failed', 'Something went wrong. Please try again.')] });
    }
}

// ─── Hold / Remove Hold ────────────────────────────────────────────────────

async function handleHold(interaction) {
    const appId = interaction.customId.split(':')[1];
    if (!appId) return interaction.reply({ embeds: [errorEmbed('Malformed Button', 'Application ID missing.')], flags: ['Ephemeral'] });

    try { await assertManager(interaction); }
    catch { return interaction.reply({ embeds: [errorEmbed('No Permission', 'You need **Manage Server** or a configured manager role.')], flags: ['Ephemeral'] }); }

    const app = await loadApp(interaction, appId);
    if (!app) return;

    if (app.status !== 'pending' && app.status !== 'on_hold') {
        const { emoji, label } = statusDisplay(app.status);
        return interaction.reply({ embeds: [errorEmbed('Cannot Hold', `Application is already **${label}** ${emoji}`)], flags: ['Ephemeral'] });
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

        try {
            const logMsg = await interaction.message.fetch();
            if (logMsg.embeds.length > 0) {
                const old = logMsg.embeds[0];
                const fields = old.fields.map(f => f.name === '📊 Status' ? { name: '📊 Status', value: `${emoji} ${label}`, inline: true } : f);
                const newButtons = buildLogButtons(appId, newStatus);
                await logMsg.edit({
                    embeds: [EmbedBuilder.from(old).setColor(color).setFields(fields).setFooter({ text: isRemoving ? `Hold removed by ${interaction.user.tag}` : `On hold by ${interaction.user.tag}` }).setTimestamp()],
                    components: newButtons ? [newButtons] : [],
                });
            }
        } catch (err) { logger.warn('Could not update log embed', { error: err.message }); }

        await interaction.reply({
            embeds: [new EmbedBuilder().setDescription(isRemoving ? `⏸️ Hold removed — application is back to **Pending Review**.` : `⏸️ Application placed **On Hold**.`).setColor(color)],
            flags: ['Ephemeral'],
        });
    } catch (err) {
        logger.error('Error toggling hold', { error: err.message, appId });
        await interaction.reply({ embeds: [errorEmbed('Hold Failed', 'Something went wrong.')], flags: ['Ephemeral'] });
    }
}

// ─── Add Note ──────────────────────────────────────────────────────────────

async function handleNote(interaction) {
    const appId = interaction.customId.split(':')[1];
    if (!appId) return interaction.reply({ embeds: [errorEmbed('Malformed Button', 'Application ID missing.')], flags: ['Ephemeral'] });

    try { await assertManager(interaction); }
    catch { return interaction.reply({ embeds: [errorEmbed('No Permission', 'You need **Manage Server** or a configured manager role.')], flags: ['Ephemeral'] }); }

    const app = await loadApp(interaction, appId);
    if (!app) return;

    const modalId = `appnote_${appId}`;
    const modal = new ModalBuilder().setCustomId(modalId).setTitle('📝 Add Staff Note');
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
        submit = await interaction.awaitModalSubmit({ time: 5 * 60_000, filter: i => i.customId === modalId && i.user.id === interaction.user.id });
    } catch { return; }

    await submit.deferReply({ flags: ['Ephemeral'] });

    const noteText = submit.fields.getTextInputValue('note').trim();

    try {
        const notes = Array.isArray(app.notes) ? app.notes : [];
        notes.push({ text: noteText, authorId: interaction.user.id, authorTag: interaction.user.tag, timestamp: Date.now() });
        await updateApplication(interaction.client, interaction.guild.id, appId, { notes });

        try {
            const logMsg = await interaction.message.fetch();
            if (logMsg.embeds.length > 0) {
                await logMsg.edit({ embeds: [EmbedBuilder.from(logMsg.embeds[0]).setFooter({ text: `📝 ${notes.length} staff note${notes.length === 1 ? '' : 's'}` }).setTimestamp()] });
            }
        } catch (err) { logger.warn('Could not update log embed', { error: err.message }); }

        await submit.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('📝 Note Added')
                    .setDescription(`Your note has been saved.\n\n> ${noteText}`)
                    .setColor(getColor('primary') || '#5865F2')
                    .setFooter({ text: `${notes.length} total note${notes.length === 1 ? '' : 's'} on this application` }),
            ],
        });
    } catch (err) {
        logger.error('Error saving note', { error: err.message, appId });
        await submit.editReply({ embeds: [errorEmbed('Save Failed', 'Could not save the note.')] });
    }
}

export default [
    { name: 'app_approve', execute: interaction => handleReview(interaction, true)  },
    { name: 'app_deny',    execute: interaction => handleReview(interaction, false) },
    { name: 'app_hold',    execute: handleHold },
    { name: 'app_note',    execute: handleNote },
];
