// ============================================================
// src/interactions/selectMenus/application.js  — v2
// Handles:  app_role_select  (apply flow + eligibility checks)
//           app_configure    (per-role configuration dashboard)
// ============================================================

import {
    ModalBuilder,
    ActionRowBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import {
    getApplicationRoles,
    saveApplicationRoles,
    getApplicationRoleSettings,
    saveApplicationRoleSettings,
    getApplicationSettings,
    getUserApplications,
    updateApplication,
    createApplication,
} from '../../utils/database.js';
import { statusDisplay, buildLogButtons, buildConfigPanel } from '../../commands/Community/application.js';

// ─── Helper: eligibility check ─────────────────────────────────────────────

async function checkEligibility(interaction, roleSettings) {
    const member = interaction.member;
    const errors = [];

    // Already has the role?
    if (member.roles.cache.has(interaction.values[0])) {
        return ['You already have this role!'];
    }

    // Min account age
    if (roleSettings.minAccountAgeDays) {
        const accountAgeDays = (Date.now() - interaction.user.createdTimestamp) / (1000 * 60 * 60 * 24);
        if (accountAgeDays < roleSettings.minAccountAgeDays) {
            const needed = Math.ceil(roleSettings.minAccountAgeDays - accountAgeDays);
            errors.push(`Your account must be at least **${roleSettings.minAccountAgeDays} days old** to apply. (${needed} more day(s) needed)`);
        }
    }

    // Required roles
    if (roleSettings.requiredRoles?.length) {
        const missing = roleSettings.requiredRoles.filter(r => !member.roles.cache.has(r));
        if (missing.length) {
            errors.push(`You need the following role(s) to apply: ${missing.map(r => `<@&${r}>`).join(', ')}`);
        }
    }

    // Blacklisted roles
    if (roleSettings.blacklistedRoles?.length) {
        const blocked = roleSettings.blacklistedRoles.filter(r => member.roles.cache.has(r));
        if (blocked.length) {
            errors.push(`You are not eligible to apply (restricted role).`);
        }
    }

    return errors;
}

async function checkCooldown(client, guildId, userId, roleId, cooldownDays) {
    if (!cooldownDays) return null;

    const userApps = await getUserApplications(client, guildId, userId);
    const lastDenied = userApps
        .filter(a => a.roleId === roleId && a.status === 'denied' && a.reviewedAt)
        .sort((a, b) => new Date(b.reviewedAt) - new Date(a.reviewedAt))[0];

    if (!lastDenied) return null;

    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
    const elapsed = Date.now() - new Date(lastDenied.reviewedAt).getTime();

    if (elapsed < cooldownMs) {
        const remainingDays = Math.ceil((cooldownMs - elapsed) / (1000 * 60 * 60 * 24));
        return `You were recently denied for this role. You can reapply in **${remainingDays} day(s)**.`;
    }

    return null;
}

// ─── app_role_select ───────────────────────────────────────────────────────

async function handleRoleSelect(interaction) {
    const roleId = interaction.values[0];

    try {
        const appRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
        const appRole = appRoles.find(r => r.roleId === roleId);

        if (!appRole || appRole.enabled === false) {
            return interaction.reply({
                embeds: [errorEmbed('Unavailable', 'This application is no longer open.')],
                flags: ['Ephemeral'],
            });
        }

        const [settings, roleSettings] = await Promise.all([
            getApplicationSettings(interaction.client, interaction.guild.id),
            getApplicationRoleSettings(interaction.client, interaction.guild.id, roleId),
        ]);

        // ── Eligibility checks ────────────────────────────────────────────
        const eligibilityErrors = await checkEligibility(interaction, roleSettings);
        if (eligibilityErrors.length) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('❌ Not Eligible')
                        .setDescription(eligibilityErrors.join('\n\n'))
                        .setColor('#ED4245'),
                ],
                flags: ['Ephemeral'],
            });
        }

        // ── Cooldown check ────────────────────────────────────────────────
        const cooldownMsg = await checkCooldown(
            interaction.client, interaction.guild.id, interaction.user.id,
            roleId, roleSettings.cooldownDays,
        );
        if (cooldownMsg) {
            return interaction.reply({
                embeds: [new EmbedBuilder().setTitle('⏳ Cooldown').setDescription(cooldownMsg).setColor('#FEE75C')],
                flags: ['Ephemeral'],
            });
        }

        // ── Pending application check ─────────────────────────────────────
        const userApps = await getUserApplications(interaction.client, interaction.guild.id, interaction.user.id);
        const pendingForRole = userApps.find(a => a.roleId === roleId && a.status === 'pending');
        if (pendingForRole) {
            return interaction.reply({
                embeds: [errorEmbed('Already Applied', `You already have a pending application for **${appRole.name}**.\nID: \`${pendingForRole.id}\``)],
                flags: ['Ephemeral'],
            });
        }

        // ── Build & show modal ────────────────────────────────────────────
        const questions = (roleSettings.questions?.length ? roleSettings.questions : null)
            ?? settings.questions
            ?? ['Why do you want this role?', 'What experience do you have?'];
        const limited = questions.slice(0, 5);

        const modal = new ModalBuilder()
            .setCustomId(`app_submit:${roleId}`)
            .setTitle(`Apply for ${appRole.name}`.substring(0, 45));

        limited.forEach((q, i) => {
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(`q${i}`)
                        .setLabel(q.length > 45 ? `${q.substring(0, 42)}...` : q)
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setMinLength(10)
                        .setMaxLength(1000),
                ),
            );
        });

        await interaction.showModal(modal);

        // ── Await modal submission inline ─────────────────────────────────
        let submitted;
        try {
            submitted = await interaction.awaitModalSubmit({
                time: 10 * 60 * 1000,
                filter: i => i.customId === `app_submit:${roleId}` && i.user.id === interaction.user.id,
            });
        } catch { return; } // timed out

        await submitted.deferReply({ flags: ['Ephemeral'] });

        // ── Verify role still exists ──────────────────────────────────────
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) {
            return submitted.editReply({ embeds: [errorEmbed('Role no longer exists. Contact an admin.')] });
        }

        const answers = limited.map((question, i) => ({
            question,
            answer: submitted.fields.getTextInputValue(`q${i}`) ?? '',
        }));

        // ── Submit application ────────────────────────────────────────────
        const application = await createApplication(interaction.client, {
            guildId:  interaction.guild.id,
            userId:   interaction.user.id,
            roleId,
            roleName: appRole.name,
            username: interaction.user.tag,
            avatar:   interaction.user.displayAvatarURL(),
            answers,
            status:    'pending',
            createdAt: Date.now(),
        });

        // ── Confirm to applicant ──────────────────────────────────────────
        await submitted.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✅ Application Submitted!')
                    .setDescription(
                        `Your application for **${appRole.name}** is now under review.\n\n` +
                        `**Application ID:** \`${application.id}\`\n` +
                        `Track your status anytime with \`/application status\``,
                    )
                    .setColor(getColor('success') || '#57F287')
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                    .setTimestamp(),
            ],
        });

        // ── Post to log channel ───────────────────────────────────────────
        const logChannelId = roleSettings.logChannelId || settings.logChannelId;
        if (!logChannelId) return;

        const logChannel = interaction.guild.channels.cache.get(logChannelId);
        if (!logChannel) return;

        const logEmbed = new EmbedBuilder()
            .setTitle('📝 New Application')
            .setColor(getColor('warning') || '#FEE75C')
            .setAuthor({
                name: interaction.user.tag,
                iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
            })
            .addFields(
                { name: '👤 Applicant',     value: `<@${interaction.user.id}>`, inline: true },
                { name: '📋 Application',   value: appRole.name, inline: true },
                { name: '🎭 Role',          value: `<@&${roleId}>`, inline: true },
                { name: '🆔 Application ID',value: `\`${application.id}\``, inline: true },
                { name: '📊 Status',        value: '🟡 Pending Review', inline: true },
                { name: '📅 Submitted',     value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                { name: '📅 Account Age',   value: `<t:${Math.floor(interaction.user.createdTimestamp / 1000)}:R>`, inline: true },
            )
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp()
            .setFooter({ text: 'Use the buttons below to review this application' });

        if (settings.imageUrl || roleSettings.bannerUrl) {
            logEmbed.setImage(roleSettings.bannerUrl || settings.imageUrl);
        }

        answers.forEach((item, i) => {
            logEmbed.addFields({
                name: `❓ Q${i + 1}: ${item.question}`,
                value: item.answer.trim() || '*No answer provided*',
                inline: false,
            });
        });

        const logButtons = buildLogButtons(application.id, 'pending');
        const logMsg = await logChannel.send({
            content: roleSettings.pingRoleId ? `<@&${roleSettings.pingRoleId}> — new application!` : undefined,
            embeds: [logEmbed],
            components: logButtons ? [logButtons] : [],
        });

        await updateApplication(interaction.client, interaction.guild.id, application.id, {
            logMessageId: logMsg.id,
            logChannelId,
        });

    } catch (err) {
        logger.error('Error in app_role_select', { error: err.message, stack: err.stack });
        const errEmbed = errorEmbed('Something went wrong', 'Please try again.');
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [errEmbed], flags: ['Ephemeral'] });
            } else {
                await interaction.reply({ embeds: [errEmbed], flags: ['Ephemeral'] });
            }
        } catch { /* already handled */ }
    }
}

// ─── app_configure ─────────────────────────────────────────────────────────

async function handleConfigure(interaction) {
    // customId = 'app_configure:roleId'
    const roleId = interaction.customId.split(':')[1];
    const option = interaction.values[0];

    try {
        // ── Toggle (no modal needed) ──────────────────────────────────────
        if (option === 'toggle') {
            const appRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
            const appRole = appRoles.find(r => r.roleId === roleId);
            if (appRole) appRole.enabled = !appRole.enabled;
            await saveApplicationRoles(interaction.client, interaction.guild.id, appRoles);

            const { embed, selectRow } = await buildConfigPanel(interaction.client, interaction.guild, roleId);
            return interaction.update({ embeds: [embed], components: [selectRow] });
        }

        // ── Options that need modals ──────────────────────────────────────
        const modalConfig = {
            questions: {
                title: 'Edit Questions',
                fields: [
                    { id: 'q1', label: 'Question 1 (required)',  required: true,  placeholder: 'Why do you want this role?' },
                    { id: 'q2', label: 'Question 2 (optional)',  required: false, placeholder: 'What experience do you have?' },
                    { id: 'q3', label: 'Question 3 (optional)',  required: false, placeholder: '' },
                    { id: 'q4', label: 'Question 4 (optional)',  required: false, placeholder: '' },
                    { id: 'q5', label: 'Question 5 (optional)',  required: false, placeholder: '' },
                ],
            },
            log_channel: {
                title: 'Set Log Channel',
                fields: [{ id: 'value', label: 'Channel ID (right-click → Copy ID)', required: true, placeholder: '123456789012345678' }],
            },
            ping_role: {
                title: 'Set Staff Ping Role',
                fields: [{ id: 'value', label: 'Role ID (right-click → Copy ID) or "none"', required: true, placeholder: '123456789012345678' }],
            },
            banner: {
                title: 'Set Banner Image URL',
                fields: [{ id: 'value', label: 'Image URL (must start with https://)', required: false, placeholder: 'https://i.imgur.com/example.png' }],
            },
            description: {
                title: 'Set Description',
                fields: [{ id: 'value', label: 'Description (shown in /application apply)', required: false, placeholder: 'Brief description of this role and what applicants should know...' }],
            },
            required_roles: {
                title: 'Required Roles',
                fields: [{ id: 'value', label: 'Role IDs (comma-separated) or "none"', required: false, placeholder: '123456789, 987654321' }],
            },
            blacklisted_roles: {
                title: 'Blacklisted Roles',
                fields: [{ id: 'value', label: 'Role IDs (comma-separated) or "none"', required: false, placeholder: '123456789, 987654321' }],
            },
            cooldown: {
                title: 'Set Reapply Cooldown',
                fields: [{ id: 'value', label: 'Days before denied users can reapply (0 = none)', required: true, placeholder: '7' }],
            },
            min_age: {
                title: 'Set Minimum Account Age',
                fields: [{ id: 'value', label: 'Minimum account age in days (0 = none)', required: true, placeholder: '30' }],
            },
        };

        const config = modalConfig[option];
        if (!config) return;

        const modalId = `app_cfg_${option}:${roleId}`;
        const modal = new ModalBuilder().setCustomId(modalId).setTitle(config.title);

        // Pre-fill current values if possible
        const currentSettings = await getApplicationRoleSettings(interaction.client, interaction.guild.id, roleId);

        config.fields.forEach((field, i) => {
            let currentValue = '';
            if (option === 'questions') {
                currentValue = currentSettings.questions?.[i] ?? '';
            } else if (option === 'log_channel') {
                currentValue = currentSettings.logChannelId ?? '';
            } else if (option === 'ping_role') {
                currentValue = currentSettings.pingRoleId ?? '';
            } else if (option === 'banner') {
                currentValue = currentSettings.bannerUrl ?? '';
            } else if (option === 'description') {
                currentValue = currentSettings.description ?? '';
            } else if (option === 'required_roles') {
                currentValue = currentSettings.requiredRoles?.join(', ') ?? '';
            } else if (option === 'blacklisted_roles') {
                currentValue = currentSettings.blacklistedRoles?.join(', ') ?? '';
            } else if (option === 'cooldown') {
                currentValue = String(currentSettings.cooldownDays ?? '0');
            } else if (option === 'min_age') {
                currentValue = String(currentSettings.minAccountAgeDays ?? '0');
            }

            const input = new TextInputBuilder()
                .setCustomId(field.id)
                .setLabel(field.label)
                .setStyle(field.id === 'value' && (option === 'description') ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(field.required)
                .setMaxLength(option === 'description' ? 300 : 100);

            if (field.placeholder) input.setPlaceholder(field.placeholder);
            if (currentValue) input.setValue(currentValue.substring(0, option === 'description' ? 300 : 100));

            modal.addComponents(new ActionRowBuilder().addComponents(input));
        });

        await interaction.showModal(modal);

        // ── Await modal submission ────────────────────────────────────────
        let submitted;
        try {
            submitted = await interaction.awaitModalSubmit({
                time: 10 * 60 * 1000,
                filter: i => i.customId === modalId && i.user.id === interaction.user.id,
            });
        } catch { return; }

        await submitted.deferReply({ flags: ['Ephemeral'] });

        // ── Process the update ────────────────────────────────────────────
        const existingSettings = await getApplicationRoleSettings(
            interaction.client, interaction.guild.id, roleId,
        );
        const updates = { ...existingSettings };

        if (option === 'questions') {
            updates.questions = ['q1', 'q2', 'q3', 'q4', 'q5']
                .map(id => submitted.fields.getTextInputValue(id)?.trim() ?? '')
                .filter(q => q.length > 0);
        } else {
            const raw = submitted.fields.getTextInputValue('value')?.trim() ?? '';

            if (option === 'log_channel') {
                updates.logChannelId = raw.toLowerCase() === 'none' ? null : raw || null;
            } else if (option === 'ping_role') {
                updates.pingRoleId = raw.toLowerCase() === 'none' ? null : raw || null;
            } else if (option === 'banner') {
                if (raw && !raw.startsWith('https://')) {
                    return submitted.editReply({ embeds: [errorEmbed('URL must start with `https://`.')] });
                }
                updates.bannerUrl = raw || null;
            } else if (option === 'description') {
                updates.description = raw || null;
            } else if (option === 'required_roles') {
                updates.requiredRoles = raw.toLowerCase() === 'none' ? [] :
                    raw.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
            } else if (option === 'blacklisted_roles') {
                updates.blacklistedRoles = raw.toLowerCase() === 'none' ? [] :
                    raw.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
            } else if (option === 'cooldown') {
                updates.cooldownDays = Math.max(0, parseInt(raw) || 0);
            } else if (option === 'min_age') {
                updates.minAccountAgeDays = Math.max(0, parseInt(raw) || 0);
            }
        }

        await saveApplicationRoleSettings(interaction.client, interaction.guild.id, roleId, updates);

        // ── Reply with updated config panel ───────────────────────────────
        const { embed, selectRow } = await buildConfigPanel(
            interaction.client, interaction.guild, roleId,
        );

        await submitted.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✅ Saved')
                    .setDescription(`**${option.replace(/_/g, ' ')}** has been updated.`)
                    .setColor('#57F287'),
                embed,
            ],
            components: [selectRow],
        });

    } catch (err) {
        logger.error('Error in app_configure handler', { error: err.message, stack: err.stack });
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [errorEmbed('Something went wrong.')], flags: ['Ephemeral'] });
            } else {
                await interaction.reply({ embeds: [errorEmbed('Something went wrong.')], flags: ['Ephemeral'] });
            }
        } catch { /* ignore */ }
    }
}

// ─── Exports ───────────────────────────────────────────────────────────────

export default [
    { name: 'app_role_select', execute: handleRoleSelect },
    { name: 'app_configure',   execute: handleConfigure  },
];
