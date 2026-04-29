import {
    SlashCommandBuilder,
    PermissionFlagsBits,
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
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import ApplicationService from '../../services/applicationService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    getApplicationSettings,
    getApplicationRoles,
    saveApplicationRoles,
    saveApplicationRoleSettings,
    getApplicationRoleSettings,
    getApplication,
    getApplications,
    getUserApplications,
    deleteApplication,
} from '../../utils/database.js';

function statusDisplay(status) {
    const s = typeof status === 'string' ? status.trim().toLowerCase() : 'unknown';
    return {
        label: { pending: 'In Progress', approved: 'Accepted', denied: 'Denied' }[s] ?? 'Unknown',
        emoji: { pending: '🟡', approved: '🟢', denied: '🔴' }[s] ?? '⚪',
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('application')
        .setDescription('Role application system')
        .addSubcommand(sub =>
            sub.setName('apply').setDescription('Browse open roles and submit an application'),
        )
        .addSubcommand(sub =>
            sub.setName('status').setDescription('Check the status of your applications'),
        )
        .addSubcommand(sub =>
            sub.setName('setup').setDescription('[Admin] Create a new application role'),
        )
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('[Admin] View submitted applications')
                .addStringOption(opt =>
                    opt
                        .setName('status')
                        .setDescription('Filter by status (default: pending)')
                        .addChoices(
                            { name: '🟡 Pending', value: 'pending' },
                            { name: '🟢 Approved', value: 'approved' },
                            { name: '🔴 Denied', value: 'denied' },
                        ),
                )
                .addUserOption(opt =>
                    opt.setName('user').setDescription('Filter by a specific user'),
                ),
        )
        .addSubcommand(sub =>
            sub
                .setName('settings')
                .setDescription('[Admin] View or update application settings')
                .addChannelOption(opt =>
                    opt
                        .setName('log-channel')
                        .setDescription('Channel where new applications are posted')
                        .addChannelTypes(ChannelType.GuildText),
                )
                .addRoleOption(opt =>
                    opt.setName('manager-role').setDescription('Role that can review applications'),
                )
                .addStringOption(opt =>
                    opt
                        .setName('image-url')
                        .setDescription('Banner image shown on application embeds (HTTPS)'),
                ),
        )
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('[Admin] Remove an application role')
                .addStringOption(opt =>
                    opt
                        .setName('name')
                        .setDescription('Name of the application to remove')
                        .setRequired(true)
                        .setAutocomplete(true),
                ),
        ),

    category: 'Community',

    execute: withErrorHandling(
        async interaction => {
            if (!interaction.inGuild()) {
                return InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('This command can only be used in a server.')],
                    flags: ['Ephemeral'],
                });
            }

            const sub = interaction.options.getSubcommand();

            if (sub === 'status' || sub === 'list' || sub === 'settings' || sub === 'remove') {
                await InteractionHelper.safeDefer(interaction, { flags: ['Ephemeral'] });
            }

            logger.info(`/application ${sub}`, { userId: interaction.user.id, guildId: interaction.guild.id });

            if (sub === 'apply') return handleApply(interaction);
            if (sub === 'status') return handleStatus(interaction);
            if (sub === 'setup') return handleSetup(interaction);
            if (sub === 'list') return handleList(interaction);
            if (sub === 'settings') return handleSettings(interaction);
            if (sub === 'remove') return handleRemove(interaction);
        },
        { type: 'command', commandName: 'application' },
    ),
};

async function handleApply(interaction) {
    const settings = await getApplicationSettings(interaction.client, interaction.guild.id);

    if (!settings.enabled) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [errorEmbed('Applications Closed', 'Applications are currently disabled in this server.')],
            flags: ['Ephemeral'],
        });
    }

    const appRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
    const enabled = appRoles.filter(r => r.enabled !== false);

    if (enabled.length === 0) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [errorEmbed('No Open Applications', 'There are no open applications right now. Check back later!')],
            flags: ['Ephemeral'],
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('📋 Open Applications')
        .setDescription('Select a role below to apply. Fill in the form and your application will be sent to our staff for review.')
        .setColor(getColor('primary') || '#5865F2')
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
        .setFooter({ text: `${interaction.guild.name} • Applications` })
        .setTimestamp();

    if (settings.imageUrl) embed.setImage(settings.imageUrl);

    enabled.forEach((appRole, i) => {
        const role = interaction.guild.roles.cache.get(appRole.roleId);
        embed.addFields({
            name: `${i + 1}. ${appRole.name}`,
            value: role ? `<@&${appRole.roleId}>` : '*(role not found)*',
            inline: true,
        });
    });

    const select = new StringSelectMenuBuilder()
        .setCustomId('app_role_select')
        .setPlaceholder('Choose a role to apply for...')
        .addOptions(
            enabled.map(appRole => {
                const role = interaction.guild.roles.cache.get(appRole.roleId);
                return new StringSelectMenuOptionBuilder()
                    .setLabel(appRole.name)
                    .setDescription(role ? `Apply for the ${role.name} role` : 'Apply for this role')
                    .setValue(appRole.roleId);
            }),
        );

    return InteractionHelper.safeReply(interaction, {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(select)],
        flags: ['Ephemeral'],
    });
}

async function handleStatus(interaction) {
    const apps = await getUserApplications(interaction.client, interaction.guild.id, interaction.user.id);

    if (apps.length === 0) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('No Applications', "You haven't submitted any applications yet.\nUse `/application apply` to get started!")],
        });
    }

    const recent = apps.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 10);

    const embed = new EmbedBuilder()
        .setTitle('📊 Your Applications')
        .setDescription(`Showing ${recent.length} of your most recent application(s).`)
        .setColor(getColor('info') || '#5865F2')
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }));

    recent.forEach(app => {
        const { emoji, label } = statusDisplay(app.status);
        const date = app.createdAt ? `<t:${Math.floor(new Date(app.createdAt).getTime() / 1000)}:d>` : 'Unknown';
        embed.addFields({
            name: `${emoji} ${app.roleName ?? 'Unknown Role'}`,
            value: `**Status:** ${emoji} ${label}\n**ID:** \`${app.id}\`\n**Submitted:** ${date}`,
            inline: true,
        });
    });

    return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

async function handleSetup(interaction) {
    if (interaction.deferred || interaction.replied) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [errorEmbed('Interaction already processed. Please run the command again.')],
            flags: ['Ephemeral'],
        });
    }

    await ApplicationService.checkManagerPermission(interaction.client, interaction.guild.id, interaction.member);

    const modal = new ModalBuilder().setCustomId('app_setup_modal').setTitle('Create New Application');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('app_name').setLabel('Application Name').setStyle(TextInputStyle.Short).setPlaceholder('e.g. Moderator, Helper, Trial Staff').setMaxLength(50).setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('role_id').setLabel('Role ID').setStyle(TextInputStyle.Short).setPlaceholder('Right-click the role → Copy ID').setMaxLength(20).setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('question_1').setLabel('Question 1 (required)').setStyle(TextInputStyle.Short).setPlaceholder('Why do you want this role?').setMaxLength(100).setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('question_2').setLabel('Question 2 (optional)').setStyle(TextInputStyle.Short).setPlaceholder('What experience do you have?').setMaxLength(100).setRequired(false),
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('question_3').setLabel('Question 3 (optional)').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false),
        ),
    );

    await interaction.showModal(modal);

    try {
        const submitted = await interaction.awaitModalSubmit({
            time: 15 * 60 * 1000,
            filter: i => i.customId === 'app_setup_modal' && i.user.id === interaction.user.id,
        });

        const appName = submitted.fields.getTextInputValue('app_name').trim();
        const roleId = submitted.fields.getTextInputValue('role_id').trim();
        const questions = [
            submitted.fields.getTextInputValue('question_1').trim(),
            submitted.fields.getTextInputValue('question_2').trim(),
            submitted.fields.getTextInputValue('question_3').trim(),
        ].filter(q => q.length > 0);

        let role;
        try {
            role = await interaction.guild.roles.fetch(roleId);
        } catch {
            return submitted.reply({
                embeds: [errorEmbed('Role Not Found', 'No role exists with that ID. Make sure Developer Mode is on and you copied the Role ID correctly.')],
                flags: ['Ephemeral'],
            });
        }

        const existing = await getApplicationRoles(interaction.client, interaction.guild.id);
        if (existing.some(r => r.roleId === roleId)) {
            return submitted.reply({
                embeds: [errorEmbed('Already Configured', `${role} is already set up as an application.`)],
                flags: ['Ephemeral'],
            });
        }

        existing.push({ roleId, name: appName, enabled: true });
        await saveApplicationRoles(interaction.client, interaction.guild.id, existing);
        await saveApplicationRoleSettings(interaction.client, interaction.guild.id, roleId, { questions });

        const currentSettings = await getApplicationSettings(interaction.client, interaction.guild.id);
        if (!currentSettings.enabled) {
            await ApplicationService.updateSettings(interaction.client, interaction.guild.id, { enabled: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('✅ Application Created')
            .setDescription(
                `**${appName}** is now live for ${role}.\n\n` +
                `**Questions (${questions.length}):**\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\n` +
                `💡 Set a log channel with \`/application settings log-channel:#channel\` so applications show up for review.`,
            )
            .setColor(getColor('success') || '#57F287')
            .setThumbnail(interaction.guild.iconURL({ dynamic: true }));

        await submitted.reply({ embeds: [embed], flags: ['Ephemeral'] });
    } catch (err) {
        if (err.message?.includes('time')) return;
        throw err;
    }
}

async function handleList(interaction) {
    await ApplicationService.checkManagerPermission(interaction.client, interaction.guild.id, interaction.member);

    const statusFilter = interaction.options.getString('status') || 'pending';
    const userFilter = interaction.options.getUser('user');

    let apps = await getApplications(interaction.client, interaction.guild.id, { status: statusFilter });
    if (userFilter) apps = apps.filter(a => a.userId === userFilter.id);

    if (!userFilter) {
        const settled = await Promise.all(
            apps.map(async app => {
                try { await interaction.guild.members.fetch(app.userId); return app; }
                catch { await deleteApplication(interaction.client, interaction.guild.id, app.id, app.userId); return null; }
            }),
        );
        apps = settled.filter(Boolean);
    }

    apps = apps.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 15);

    if (apps.length === 0) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Nothing Found', `No ${statusFilter} applications found${userFilter ? ` for ${userFilter}` : ''}.`)],
        });
    }

    const { emoji: hEmoji, label: hLabel } = statusDisplay(statusFilter);
    const embed = new EmbedBuilder()
        .setTitle(`${hEmoji} ${hLabel} Applications`)
        .setDescription(`Showing ${apps.length} result(s).`)
        .setColor(getColor('info') || '#5865F2');

    apps.forEach(app => {
        const { emoji, label } = statusDisplay(app.status);
        const date = app.createdAt ? `<t:${Math.floor(new Date(app.createdAt).getTime() / 1000)}:d>` : 'Unknown';
        embed.addFields({
            name: `${emoji} ${app.roleName ?? 'Unknown'} — ${app.username ?? 'Unknown User'}`,
            value: `**ID:** \`${app.id}\`\n**Status:** ${label}\n**Submitted:** ${date}`,
            inline: true,
        });
    });

    embed.setFooter({ text: 'Staff can approve/deny directly from the log channel buttons.' });
    return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

async function handleSettings(interaction) {
    await ApplicationService.checkManagerPermission(interaction.client, interaction.guild.id, interaction.member);

    const logChannel = interaction.options.getChannel('log-channel');
    const managerRole = interaction.options.getRole('manager-role');
    const imageUrl = interaction.options.getString('image-url');
    const updates = {};
    const lines = [];

    if (logChannel) { updates.logChannelId = logChannel.id; lines.push(`📌 Log channel set to ${logChannel}`); }
    if (managerRole) {
        const current = await getApplicationSettings(interaction.client, interaction.guild.id);
        const roles = Array.isArray(current.managerRoles) ? [...current.managerRoles] : [];
        if (!roles.includes(managerRole.id)) roles.push(managerRole.id);
        updates.managerRoles = roles;
        lines.push(`👤 Manager role added: ${managerRole}`);
    }
    if (imageUrl) {
        if (!imageUrl.startsWith('https://')) return InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed('Image URL must start with `https://`.')] });
        updates.imageUrl = imageUrl;
        lines.push(`🖼️ Banner image updated`);
    }

    if (lines.length === 0) {
        const s = await getApplicationSettings(interaction.client, interaction.guild.id);
        const roles = await getApplicationRoles(interaction.client, interaction.guild.id);
        const embed = new EmbedBuilder()
            .setTitle('⚙️ Application Settings')
            .setColor(getColor('info') || '#5865F2')
            .addFields(
                { name: 'Status', value: s.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Log Channel', value: s.logChannelId ? `<#${s.logChannelId}>` : 'Not set', inline: true },
                { name: 'Manager Roles', value: s.managerRoles?.length > 0 ? s.managerRoles.map(r => `<@&${r}>`).join(', ') : 'None (uses Manage Server)', inline: true },
                { name: 'Banner Image', value: s.imageUrl ? `[Preview](${s.imageUrl})` : 'Not set', inline: true },
                { name: `Applications (${roles.length})`, value: roles.length > 0 ? roles.map(r => `• **${r.name}** — ${r.enabled !== false ? '✅ Open' : '❌ Closed'}`).join('\n') : 'None yet — use `/application setup` to create one.', inline: false },
            );
        return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }

    await ApplicationService.updateSettings(interaction.client, interaction.guild.id, updates);
    return InteractionHelper.safeEditReply(interaction, {
        embeds: [new EmbedBuilder().setTitle('✅ Settings Updated').setDescription(lines.join('\n')).setColor(getColor('success') || '#57F287')],
    });
}

async function handleRemove(interaction) {
    await ApplicationService.checkManagerPermission(interaction.client, interaction.guild.id, interaction.member);

    const name = interaction.options.getString('name');
    const existing = await getApplicationRoles(interaction.client, interaction.guild.id);
    const idx = existing.findIndex(r => r.name.toLowerCase() === name.toLowerCase());

    if (idx === -1) return InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed(`No application named **${name}** was found.`)] });

    const [removed] = existing.splice(idx, 1);
    await saveApplicationRoles(interaction.client, interaction.guild.id, existing);
    return InteractionHelper.safeEditReply(interaction, {
        embeds: [new EmbedBuilder().setTitle('🗑️ Application Removed').setDescription(`The **${removed.name}** application has been removed.`).setColor(getColor('warning') || '#FEE75C')],
    });
}
