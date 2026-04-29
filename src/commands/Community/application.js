// ============================================================
// src/commands/Community/application.js  — v2 (comprehensive)
// ============================================================

import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    EmbedBuilder,
    ComponentType,
} from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    getApplicationSettings,
    saveApplicationSettings,
    getApplicationRoles,
    saveApplicationRoles,
    saveApplicationRoleSettings,
    getApplicationRoleSettings,
    getApplication,
    getApplications,
    getUserApplications,
    updateApplication,
    deleteApplication,
} from '../../utils/database.js';

// ─── Inline permission helper ──────────────────────────────────────────────

async function checkManagerPermission(client, guildId, member) {
    if (member.permissions.has('ManageGuild')) return;
    const settings = await getApplicationSettings(client, guildId);
    const hasRole = settings.managerRoles?.some(roleId => member.roles.cache.has(roleId));
    if (!hasRole) throw new Error('You need the **Manage Server** permission or a configured manager role.');
}

// ─── Shared helpers (also imported by select menu + button files) ──────────

export function statusDisplay(status) {
    const s = typeof status === 'string' ? status.trim().toLowerCase() : 'unknown';
    const map = {
        pending:   { label: 'Pending Review', emoji: '🟡', color: '#FEE75C' },
        approved:  { label: 'Accepted',       emoji: '🟢', color: '#57F287' },
        denied:    { label: 'Denied',          emoji: '🔴', color: '#ED4245' },
        on_hold:   { label: 'On Hold',         emoji: '⏸️',  color: '#EB459E' },
        cancelled: { label: 'Cancelled',       emoji: '⬛', color: '#95A5A6' },
    };
    return map[s] ?? { label: 'Unknown', emoji: '⚪', color: '#5865F2' };
}

export function buildLogButtons(appId, currentStatus = 'pending') {
    const isFinal = ['approved', 'denied', 'cancelled'].includes(currentStatus);
    if (isFinal) return null;

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`app_approve:${appId}`)
            .setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`app_deny:${appId}`)
            .setLabel('Deny').setEmoji('❌').setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`app_hold:${appId}`)
            .setLabel(currentStatus === 'on_hold' ? 'Remove Hold' : 'Hold')
            .setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`app_note:${appId}`)
            .setLabel('Add Note').setEmoji('📝').setStyle(ButtonStyle.Secondary),
    );
}

export async function buildConfigPanel(client, guild, roleId) {
    const [roleSettings, appRoles] = await Promise.all([
        getApplicationRoleSettings(client, guild.id, roleId),
        getApplicationRoles(client, guild.id),
    ]);
    const appRole = appRoles.find(r => r.roleId === roleId);
    const role = guild.roles.cache.get(roleId);

    const questions = roleSettings.questions ?? [];
    const embed = new EmbedBuilder()
        .setTitle(`⚙️ Configure: ${appRole?.name ?? 'Unknown'}`)
        .setColor(getColor('info') || '#5865F2')
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .addFields(
            { name: '🎭 Role',         value: role ? `<@&${roleId}>` : '*(not found)*', inline: true },
            { name: '📊 Status',       value: appRole?.enabled !== false ? '✅ Open' : '❌ Closed', inline: true },
            { name: '📢 Log Channel',  value: roleSettings.logChannelId ? `<#${roleSettings.logChannelId}>` : '`Not set`', inline: true },
            { name: '🔔 Ping Role',    value: roleSettings.pingRoleId ? `<@&${roleSettings.pingRoleId}>` : '`Not set`', inline: true },
            { name: '⏰ Reapply Cooldown', value: roleSettings.cooldownDays ? `${roleSettings.cooldownDays} day(s)` : 'None', inline: true },
            { name: '📅 Min Account Age',  value: roleSettings.minAccountAgeDays ? `${roleSettings.minAccountAgeDays} day(s)` : 'None', inline: true },
            { name: '✅ Required Roles',    value: roleSettings.requiredRoles?.length ? roleSettings.requiredRoles.map(r => `<@&${r}>`).join(', ') : 'None', inline: false },
            { name: '❌ Blacklisted Roles', value: roleSettings.blacklistedRoles?.length ? roleSettings.blacklistedRoles.map(r => `<@&${r}>`).join(', ') : 'None', inline: false },
            { name: '📋 Description',      value: roleSettings.description || '*Not set*', inline: false },
            {
                name: `📝 Questions (${questions.length})`,
                value: questions.length ? questions.map((q, i) => `**${i + 1}.** ${q}`).join('\n') : '*Using defaults*',
                inline: false,
            },
        )
        .setFooter({ text: 'Select an option below to edit • Changes save instantly' });

    if (roleSettings.bannerUrl) embed.setImage(roleSettings.bannerUrl);

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`app_configure:${roleId}`)
        .setPlaceholder('Choose a setting to configure...')
        .addOptions(
            { label: '📝 Edit Questions',      description: 'Set the questions applicants answer (up to 5)', value: 'questions' },
            { label: '📢 Log Channel',          description: 'Channel where applications are posted for review', value: 'log_channel' },
            { label: '🔔 Staff Ping Role',      description: 'Ping a role when a new application is submitted', value: 'ping_role' },
            { label: '🖼️ Banner Image',         description: 'Custom banner image shown on the application embed', value: 'banner' },
            { label: '📋 Description',          description: 'Text shown in the /application apply browse menu', value: 'description' },
            { label: '✅ Required Roles',        description: 'Roles users must have to be eligible', value: 'required_roles' },
            { label: '❌ Blacklisted Roles',    description: 'Roles that are not allowed to apply', value: 'blacklisted_roles' },
            { label: '⏰ Reapply Cooldown',     description: 'Days a denied user must wait before reapplying', value: 'cooldown' },
            { label: '📅 Min Account Age',      description: 'Minimum Discord account age in days to apply', value: 'min_age' },
            { label: '🔄 Toggle Open / Closed', description: 'Enable or disable this application', value: 'toggle' },
        );

    return { embed, selectRow: new ActionRowBuilder().addComponents(selectMenu) };
}

// ─── Default questions ─────────────────────────────────────────────────────

const DEFAULT_QUESTIONS = [
    'What is your Roblox and Discord username?',
    'Why do you want to join that section of staff?',
    'Give me 3 reasons why you would be better than the other candidates?',
    'Are you over the age of 13? If so, state your Age Group.',
    'What is your timezone?',
    'Any previous experience in moderation?',
    'How many hours can you dedicate towards the group?',
    'How would you handle someone breaking the rules in the server?',
    'Will you be able to join VCs whenever needed?',
];

export default {
    data: new SlashCommandBuilder()
        .setName('application')
        .setDescription('Role application system')
        .addSubcommand(s => s.setName('apply').setDescription('Browse open roles and submit an application'))
        .addSubcommand(s => s.setName('status').setDescription('Check the status of your applications'))
        .addSubcommand(s => s.setName('cancel').setDescription('Cancel one of your pending applications'))
        .addSubcommand(s => s.setName('setup').setDescription('[Admin] Create a new application role'))
        .addSubcommand(s =>
            s.setName('configure')
                .setDescription('[Admin] Configure a specific application role')
                .addStringOption(o =>
                    o.setName('name').setDescription('Application to configure').setRequired(true).setAutocomplete(true),
                ),
        )
        .addSubcommand(s =>
            s.setName('list')
                .setDescription('[Admin] View submitted applications')
                .addStringOption(o =>
                    o.setName('status').setDescription('Filter by status (default: pending)').addChoices(
                        { name: '🟡 Pending',   value: 'pending' },
                        { name: '🟢 Approved',  value: 'approved' },
                        { name: '🔴 Denied',    value: 'denied' },
                        { name: '⏸️ On Hold',   value: 'on_hold' },
                    ),
                )
                .addUserOption(o => o.setName('user').setDescription('Filter by a specific user'))
                .addStringOption(o =>
                    o.setName('role').setDescription('Filter by application name').setAutocomplete(true),
                ),
        )
        .addSubcommand(s =>
            s.setName('review')
                .setDescription('[Admin] View full details of an application')
                .addStringOption(o =>
                    o.setName('id').setDescription('Application ID').setRequired(true),
                ),
        )
        .addSubcommand(s =>
            s.setName('history')
                .setDescription("[Admin] View a user's full application history")
                .addUserOption(o => o.setName('user').setDescription('User to look up').setRequired(true)),
        )
        .addSubcommand(s =>
            s.setName('settings')
                .setDescription('[Admin] View or update global application settings')
                .addChannelOption(o =>
                    o.setName('log-channel').setDescription('Default channel for applications').addChannelTypes(ChannelType.GuildText),
                )
                .addRoleOption(o => o.setName('manager-role').setDescription('Role that can manage applications'))
                .addStringOption(o => o.setName('image-url').setDescription('Default banner image URL (HTTPS)')),
        )
        .addSubcommand(s =>
            s.setName('remove')
                .setDescription('[Admin] Remove an application role')
                .addStringOption(o =>
                    o.setName('name').setDescription('Application to remove').setRequired(true).setAutocomplete(true),
                ),
        ),

    category: 'Community',

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('This command can only be used in a server.')],
                flags: ['Ephemeral'],
            });
        }

        const sub = interaction.options.getSubcommand();

        try {
            if (sub !== 'setup') {
                await InteractionHelper.safeDefer(interaction, { flags: ['Ephemeral'] });
            }

            logger.info(`/application ${sub}`, { userId: interaction.user.id, guildId: interaction.guild.id });

            switch (sub) {
                case 'apply':     return await handleApply(interaction);
                case 'status':    return await handleStatus(interaction);
                case 'cancel':    return await handleCancel(interaction);
                case 'setup':     return await handleSetup(interaction);
                case 'configure': return await handleConfigure(interaction);
                case 'list':      return await handleList(interaction);
                case 'review':    return await handleReview(interaction);
                case 'history':   return await handleHistory(interaction);
                case 'settings':  return await handleSettings(interaction);
                case 'remove':    return await handleRemove(interaction);
            }
        } catch (error) {
            await handleInteractionError(interaction, error, { type: 'command', commandName: 'application' });
        }
    },
};

async function handleApply(interaction) {
    const settings = await getApplicationSettings(interaction.client, interaction.guild.id);

    if (!settings.enabled) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Applications Closed', 'Applications are currently disabled in this server.')],
        });
    }

    const appRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
    const enabled = appRoles.filter(r => r.enabled !== false);

    if (enabled.length === 0) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('No Open Applications', 'There are no open applications right now. Check back later!')],
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('📋 Open Applications')
        .setColor('#5865F2')
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
        .setDescription(
            `Welcome to **${interaction.guild.name}**'s application system!\n` +
            `Browse the open roles below and select one to begin your application.\n\u200B`,
        )
        .setFooter({ text: `${interaction.guild.name} • Select a role below to start applying` })
        .setTimestamp();

    if (settings.imageUrl) embed.setImage(settings.imageUrl);

    for (const appRole of enabled) {
        const role = interaction.guild.roles.cache.get(appRole.roleId);
        const roleSettings = await getApplicationRoleSettings(interaction.client, interaction.guild.id, appRole.roleId);
        const questionCount = roleSettings.questions?.length ?? 2;

        embed.addFields({
            name: appRole.name,
            value: [
                role ? `<@&${appRole.roleId}>` : '*(role not found)*',
                roleSettings.description ? `\n*${roleSettings.description}*` : '',
                `\n📝 **${questionCount}** question${questionCount !== 1 ? 's' : ''} (answered in steps)`,
                roleSettings.requiredRoles?.length ? `\n✅ Requires specific roles` : '',
                roleSettings.minAccountAgeDays ? `\n📅 Min. account age: **${roleSettings.minAccountAgeDays}** days` : '',
                roleSettings.cooldownDays ? `\n⏰ Cooldown: **${roleSettings.cooldownDays}** days after denial` : '',
            ].join(''),
            inline: true,
        });
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId('app_role_select')
        .setPlaceholder('Choose a role to apply for...')
        .addOptions(
            enabled.map(appRole => {
                const role = interaction.guild.roles.cache.get(appRole.roleId);
                return new StringSelectMenuOptionBuilder()
                    .setLabel(appRole.name)
                    .setDescription((role ? `Apply for ${role.name}` : 'Apply for this role').substring(0, 100))
                    .setValue(appRole.roleId);
            }),
        );

    return InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(select)],
    });
}

async function handleStatus(interaction) {
    const apps = await getUserApplications(interaction.client, interaction.guild.id, interaction.user.id);

    if (apps.length === 0) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('No Applications', "You haven't submitted any applications.\nUse `/application apply` to get started!")],
        });
    }

    const recent = apps.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 10);

    const embed = new EmbedBuilder()
        .setTitle('📊 Your Applications')
        .setColor('#5865F2')
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .setDescription(`Showing ${recent.length} application(s). Most recent first.`);

    recent.forEach(app => {
        const { emoji, label } = statusDisplay(app.status);
        const date = app.createdAt ? `<t:${Math.floor(new Date(app.createdAt).getTime() / 1000)}:R>` : 'Unknown';
        const reviewNote = app.reviewMessage && app.status !== 'pending' ? `\n> *${app.reviewMessage.substring(0, 80)}*` : '';
        embed.addFields({
            name: `${emoji} ${app.roleName ?? 'Unknown Role'}`,
            value: `**Status:** ${label}\n**ID:** \`${app.id}\`\n**Submitted:** ${date}${reviewNote}`,
            inline: true,
        });
    });

    return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

async function handleCancel(interaction) {
    const apps = await getUserApplications(interaction.client, interaction.guild.id, interaction.user.id);
    const pending = apps.filter(a => a.status === 'pending' || a.status === 'on_hold');

    if (pending.length === 0) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Nothing to Cancel', 'You have no pending applications to cancel.')],
        });
    }

    let targetApp = pending[0];

    if (pending.length > 1) {
        const select = new StringSelectMenuBuilder()
            .setCustomId('cancel_pick')
            .setPlaceholder('Choose the application to cancel...')
            .addOptions(
                pending.map(app => {
                    const { emoji } = statusDisplay(app.status);
                    const date = app.createdAt ? new Date(app.createdAt).toLocaleDateString() : '?';
                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`${app.roleName ?? 'Unknown'} — ${date}`)
                        .setDescription(`${emoji} ${statusDisplay(app.status).label} • ID: ${app.id}`)
                        .setValue(app.id);
                }),
            );

        const response = await InteractionHelper.safeEditReply(interaction, {
            embeds: [new EmbedBuilder().setTitle('Which application do you want to cancel?').setColor('#FEE75C')],
            components: [new ActionRowBuilder().addComponents(select)],
        });

        const sel = await response.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            filter: i => i.user.id === interaction.user.id,
            time: 60_000,
        }).catch(() => null);

        if (!sel) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Timed out.', 'No application was cancelled.')],
                components: [],
            });
        }

        await sel.deferUpdate();
        targetApp = pending.find(a => a.id === sel.values[0]);
    }

    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_cancel').setLabel('Yes, Cancel It').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('abort_cancel').setLabel('Never mind').setStyle(ButtonStyle.Secondary),
    );

    const response2 = await InteractionHelper.safeEditReply(interaction, {
        embeds: [
            new EmbedBuilder()
                .setTitle('⚠️ Cancel Application?')
                .setDescription(`Are you sure you want to cancel your **${targetApp.roleName}** application?\n\nThis cannot be undone.`)
                .setColor('#FEE75C'),
        ],
        components: [confirmRow],
    });

    const btn = await response2.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id,
        time: 30_000,
    }).catch(() => null);

    if (!btn || btn.customId === 'abort_cancel') {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [new EmbedBuilder().setTitle('👍 Kept').setDescription('Your application was not cancelled.').setColor('#57F287')],
            components: [],
        });
    }

    await btn.deferUpdate();
    await updateApplication(interaction.client, interaction.guild.id, targetApp.id, {
        status: 'cancelled',
        reviewMessage: 'Cancelled by applicant',
        reviewedAt: new Date().toISOString(),
    });

    if (targetApp.logMessageId && targetApp.logChannelId) {
        try {
            const logChannel = interaction.guild.channels.cache.get(targetApp.logChannelId);
            const logMsg = await logChannel?.messages.fetch(targetApp.logMessageId).catch(() => null);
            if (logMsg?.embeds[0]) {
                const { emoji, color } = statusDisplay('cancelled');
                const fields = logMsg.embeds[0].fields.map(f =>
                    f.name === '📊 Status' ? { name: '📊 Status', value: `${emoji} Cancelled by applicant`, inline: true } : f,
                );
                await logMsg.edit({
                    embeds: [EmbedBuilder.from(logMsg.embeds[0]).setColor(color).setFields(fields).setFooter({ text: 'Applicant cancelled this application' })],
                    components: [],
                });
            }
        } catch { /* ignore */ }
    }

    return InteractionHelper.safeEditReply(interaction, {
        embeds: [new EmbedBuilder().setTitle('✅ Application Cancelled').setDescription(`Your **${targetApp.roleName}** application has been cancelled.`).setColor('#57F287')],
        components: [],
    });
}

async function handleSetup(interaction) {
    await checkManagerPermission(interaction.client, interaction.guild.id, interaction.member);

    const modal = new ModalBuilder().setCustomId('app_setup_modal').setTitle('Create New Application');
    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('app_name').setLabel('Application Name').setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. Moderator, Helper, Trial Staff').setMaxLength(50).setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('role_id').setLabel('Role ID').setStyle(TextInputStyle.Short)
                .setPlaceholder('Right-click the role → Copy ID').setMaxLength(20).setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('question_1').setLabel('Custom Question 1 (optional)').setStyle(TextInputStyle.Short)
                .setPlaceholder('Leave blank to use the 9 default questions').setMaxLength(100).setRequired(false),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('question_2').setLabel('Custom Question 2 (optional)').setStyle(TextInputStyle.Short)
                .setMaxLength(100).setRequired(false),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('question_3').setLabel('Custom Question 3 (optional)').setStyle(TextInputStyle.Short)
                .setMaxLength(100).setRequired(false),
        ),
    );

    await interaction.showModal(modal);

    let submitted;
    try {
        submitted = await interaction.awaitModalSubmit({
            time: 15 * 60 * 1000,
            filter: i => i.customId === 'app_setup_modal' && i.user.id === interaction.user.id,
        });
    } catch { return; }

    const appName = submitted.fields.getTextInputValue('app_name').trim();
    const roleId  = submitted.fields.getTextInputValue('role_id').trim();
    const customQuestions = [
        submitted.fields.getTextInputValue('question_1').trim(),
        submitted.fields.getTextInputValue('question_2').trim(),
        submitted.fields.getTextInputValue('question_3').trim(),
    ].filter(q => q);

    let role;
    try { role = await interaction.guild.roles.fetch(roleId); }
    catch {
        return submitted.reply({
            embeds: [errorEmbed('Role Not Found', 'No role found with that ID. Enable Developer Mode (User Settings → Advanced) to copy Role IDs.')],
            flags: ['Ephemeral'],
        });
    }

    const existing = await getApplicationRoles(interaction.client, interaction.guild.id);
    if (existing.some(r => r.roleId === roleId)) {
        return submitted.reply({
            embeds: [errorEmbed('Already Exists', `${role} is already configured. Use \`/application configure\` to edit it.`)],
            flags: ['Ephemeral'],
        });
    }

    existing.push({ roleId, name: appName, enabled: true });
    await saveApplicationRoles(interaction.client, interaction.guild.id, existing);

    const finalQuestions = customQuestions.length > 0
        ? [...customQuestions, ...DEFAULT_QUESTIONS.slice(customQuestions.length)]
        : DEFAULT_QUESTIONS;

    await saveApplicationRoleSettings(interaction.client, interaction.guild.id, roleId, { questions: finalQuestions });

    const currentSettings = await getApplicationSettings(interaction.client, interaction.guild.id);
    if (!currentSettings.enabled) {
        await saveApplicationSettings(interaction.client, interaction.guild.id, { enabled: true });
    }

    const embed = new EmbedBuilder()
        .setTitle('✅ Application Created')
        .setColor('#57F287')
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
        .setDescription(
            `**${appName}** is now open and accepting applications for ${role}.\n\n` +
            `📋 **${finalQuestions.length} questions** loaded — members answer them in two steps.\n\n` +
            `💡 **Next steps:**\n` +
            `> • Set a log channel: \`/application configure name:${appName}\`\n` +
            `> • Set a staff ping role, banner, eligibility rules, and more.`,
        )
        .addFields({
            name: '📝 Questions Preview',
            value: finalQuestions.slice(0, 5).map((q, i) => `**${i + 1}.** ${q}`).join('\n') +
                (finalQuestions.length > 5 ? `\n*...and ${finalQuestions.length - 5} more*` : ''),
            inline: false,
        })
        .setFooter({ text: `${interaction.guild.name} • Application System` })
        .setTimestamp();

    await submitted.reply({ embeds: [embed], flags: ['Ephemeral'] });
}

async function handleConfigure(interaction) {
    await checkManagerPermission(interaction.client, interaction.guild.id, interaction.member);

    const name = interaction.options.getString('name');
    const appRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
    const appRole = appRoles.find(r => r.name.toLowerCase() === name.toLowerCase());

    if (!appRole) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed(`No application named **${name}** found.`)],
        });
    }

    const { embed, selectRow } = await buildConfigPanel(interaction.client, interaction.guild, appRole.roleId);
    return InteractionHelper.safeEditReply(interaction, { embeds: [embed], components: [selectRow] });
}

async function handleList(interaction) {
    await checkManagerPermission(interaction.client, interaction.guild.id, interaction.member);

    const statusFilter = interaction.options.getString('status') || 'pending';
    const userFilter   = interaction.options.getUser('user');
    const roleFilter   = interaction.options.getString('role');

    let apps = await getApplications(interaction.client, interaction.guild.id, { status: statusFilter });
    if (userFilter) apps = apps.filter(a => a.userId === userFilter.id);
    if (roleFilter) apps = apps.filter(a => a.roleName?.toLowerCase().includes(roleFilter.toLowerCase()));

    if (!userFilter) {
        const checked = await Promise.all(
            apps.map(async app => {
                try { await interaction.guild.members.fetch(app.userId); return app; }
                catch { await deleteApplication(interaction.client, interaction.guild.id, app.id, app.userId); return null; }
            }),
        );
        apps = checked.filter(Boolean);
    }

    apps = apps.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 15);

    if (apps.length === 0) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Nothing Found', `No ${statusFilter} applications found.`)],
        });
    }

    const { emoji: hEmoji, label: hLabel, color } = statusDisplay(statusFilter);
    const embed = new EmbedBuilder()
        .setTitle(`${hEmoji} ${hLabel} Applications`)
        .setDescription(`Showing ${apps.length} result(s). Use \`/application review id:<id>\` for full details.`)
        .setColor(color);

    apps.forEach(app => {
        const { emoji, label } = statusDisplay(app.status);
        const date = app.createdAt ? `<t:${Math.floor(new Date(app.createdAt).getTime() / 1000)}:d>` : '?';
        embed.addFields({
            name: `${emoji} ${app.roleName ?? 'Unknown'} — ${app.username ?? 'Unknown'}`,
            value: `**ID:** \`${app.id}\`\n**Status:** ${label}\n**Date:** ${date}`,
            inline: true,
        });
    });

    embed.setFooter({ text: 'Staff can approve/deny via buttons on the log channel embed' });
    return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

async function handleReview(interaction) {
    await checkManagerPermission(interaction.client, interaction.guild.id, interaction.member);

    const appId = interaction.options.getString('id').trim();
    const app = await getApplication(interaction.client, interaction.guild.id, appId);

    if (!app) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Application Not Found', `No application with ID \`${appId}\` was found.`)],
        });
    }

    const { emoji, label, color } = statusDisplay(app.status);
    const embed = new EmbedBuilder()
        .setTitle(`📋 Application — ${app.roleName ?? 'Unknown Role'}`)
        .setColor(color)
        .setAuthor({ name: app.username ?? 'Unknown', iconURL: app.avatar ?? undefined })
        .addFields(
            { name: '👤 Applicant', value: `<@${app.userId}>`, inline: true },
            { name: '📊 Status',    value: `${emoji} ${label}`, inline: true },
            { name: '🆔 ID',        value: `\`${app.id}\``, inline: true },
            { name: '📅 Submitted', value: app.createdAt ? `<t:${Math.floor(new Date(app.createdAt).getTime() / 1000)}:F>` : 'Unknown', inline: true },
        )
        .setThumbnail(app.avatar ?? null)
        .setTimestamp();

    if (app.reviewerId) embed.addFields({ name: '👮 Reviewed By', value: `<@${app.reviewerId}>`, inline: true });
    if (app.reviewMessage) embed.addFields({ name: '💬 Review Note', value: app.reviewMessage, inline: false });

    if (app.answers?.length) {
        embed.addFields({ name: '\u200B', value: '**── Answers ──**', inline: false });
        app.answers.forEach((item, i) => {
            embed.addFields({ name: `Q${i + 1}: ${item.question}`, value: item.answer || '*No answer*', inline: false });
        });
    }

    if (app.notes?.length) {
        embed.addFields({
            name: `📝 Internal Notes (${app.notes.length})`,
            value: app.notes.map(n => `**${n.authorTag ?? 'Staff'}** <t:${Math.floor(n.createdAt / 1000)}:R>\n> ${n.content}`).join('\n\n').substring(0, 1024),
            inline: false,
        });
    }

    const buttons = buildLogButtons(app.id, app.status);
    return InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        ...(buttons ? { components: [buttons] } : {}),
    });
}

async function handleHistory(interaction) {
    await checkManagerPermission(interaction.client, interaction.guild.id, interaction.member);

    const targetUser = interaction.options.getUser('user');
    const apps = await getUserApplications(interaction.client, interaction.guild.id, targetUser.id);

    if (apps.length === 0) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('No History', `${targetUser} has not submitted any applications.`)],
        });
    }

    const sorted = apps.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const embed = new EmbedBuilder()
        .setTitle(`📁 Application History — ${targetUser.tag}`)
        .setColor('#5865F2')
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .setDescription(`**${sorted.length}** application(s) total.`);

    sorted.slice(0, 12).forEach(app => {
        const { emoji, label } = statusDisplay(app.status);
        const date = app.createdAt ? `<t:${Math.floor(new Date(app.createdAt).getTime() / 1000)}:d>` : '?';
        embed.addFields({ name: `${emoji} ${app.roleName ?? 'Unknown'}`, value: `${label} • ${date}\n\`${app.id}\``, inline: true });
    });

    return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

async function handleSettings(interaction) {
    await checkManagerPermission(interaction.client, interaction.guild.id, interaction.member);

    const logChannel  = interaction.options.getChannel('log-channel');
    const managerRole = interaction.options.getRole('manager-role');
    const imageUrl    = interaction.options.getString('image-url');
    const updates = {};
    const lines = [];

    if (logChannel)  { updates.logChannelId = logChannel.id; lines.push(`📌 Default log channel: ${logChannel}`); }
    if (managerRole) {
        const cur = await getApplicationSettings(interaction.client, interaction.guild.id);
        const roles = [...(cur.managerRoles ?? [])];
        if (!roles.includes(managerRole.id)) roles.push(managerRole.id);
        updates.managerRoles = roles;
        lines.push(`👤 Manager role added: ${managerRole}`);
    }
    if (imageUrl) {
        if (!imageUrl.startsWith('https://')) {
            return InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed('Image URL must start with `https://`.')] });
        }
        updates.imageUrl = imageUrl;
        lines.push(`🖼️ Default banner updated`);
    }

    if (!lines.length) {
        const s = await getApplicationSettings(interaction.client, interaction.guild.id);
        const roles = await getApplicationRoles(interaction.client, interaction.guild.id);
        const embed = new EmbedBuilder()
            .setTitle('⚙️ Global Application Settings')
            .setColor('#5865F2')
            .addFields(
                { name: 'System',        value: s.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Default Log',   value: s.logChannelId ? `<#${s.logChannelId}>` : 'Not set', inline: true },
                { name: 'Manager Roles', value: s.managerRoles?.length ? s.managerRoles.map(r => `<@&${r}>`).join(', ') : 'None (Manage Server)', inline: false },
                { name: 'Default Banner',value: s.imageUrl ? `[Preview](${s.imageUrl})` : 'Not set', inline: true },
                {
                    name: `Applications (${roles.length})`,
                    value: roles.length ? roles.map(r => `• **${r.name}** ${r.enabled !== false ? '✅' : '❌'}`).join('\n') : 'None — use `/application setup` to create one.',
                    inline: false,
                },
            )
            .setFooter({ text: 'Use /application configure to edit per-role settings' });
        return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }

    await saveApplicationSettings(interaction.client, interaction.guild.id, updates);
    return InteractionHelper.safeEditReply(interaction, {
        embeds: [new EmbedBuilder().setTitle('✅ Settings Updated').setDescription(lines.join('\n')).setColor('#57F287')],
    });
}

async function handleRemove(interaction) {
    await checkManagerPermission(interaction.client, interaction.guild.id, interaction.member);

    const name = interaction.options.getString('name');
    const existing = await getApplicationRoles(interaction.client, interaction.guild.id);
    const idx = existing.findIndex(r => r.name.toLowerCase() === name.toLowerCase());

    if (idx === -1) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed(`No application named **${name}** was found.`)],
        });
    }

    const [removed] = existing.splice(idx, 1);
    await saveApplicationRoles(interaction.client, interaction.guild.id, existing);

    return InteractionHelper.safeEditReply(interaction, {
        embeds: [new EmbedBuilder().setTitle('🗑️ Application Removed').setDescription(`**${removed.name}** has been removed.`).setColor('#FEE75C')],
    });
}
