import {
    ModalBuilder,
    ActionRowBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
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

async function checkEligibility(interaction, roleSettings) {
    const member = interaction.member;
    const errors = [];
    if (member.roles.cache.has(interaction.values[0])) return ['You already have this role!'];
    if (roleSettings.minAccountAgeDays) {
        const ageDays = (Date.now() - interaction.user.createdTimestamp) / 86_400_000;
        if (ageDays < roleSettings.minAccountAgeDays) {
            const needed = Math.ceil(roleSettings.minAccountAgeDays - ageDays);
            errors.push(`⏰ Your account must be at least **${roleSettings.minAccountAgeDays} days old**.\n*(${needed} more day(s) needed)*`);
        }
    }
    if (roleSettings.requiredRoles?.length) {
        const missing = roleSettings.requiredRoles.filter(r => !member.roles.cache.has(r));
        if (missing.length) errors.push(`✅ You need: ${missing.map(r => `<@&${r}>`).join(', ')}`);
    }
    if (roleSettings.blacklistedRoles?.length) {
        const blocked = roleSettings.blacklistedRoles.filter(r => member.roles.cache.has(r));
        if (blocked.length) errors.push(`🚫 You are not eligible to apply (restricted role).`);
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
    const elapsed = Date.now() - new Date(lastDenied.reviewedAt).getTime();
    const cooldownMs = cooldownDays * 86_400_000;
    if (elapsed < cooldownMs) {
        const remainingDays = Math.ceil((cooldownMs - elapsed) / 86_400_000);
        return `You were recently denied. You can reapply in **${remainingDays} day(s)**.`;
    }
    return null;
}

function buildQuestionModal(customId, title, questions) {
    const modal = new ModalBuilder().setCustomId(customId).setTitle(title.substring(0, 45));
    questions.forEach((q, i) => {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(`q${i}`)
                    .setLabel(q.length > 45 ? `${q.substring(0, 42)}...` : q)
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMinLength(5)
                    .setMaxLength(800),
            ),
        );
    });
    return modal;
}

async function handleRoleSelect(interaction) {
    const roleId = interaction.values[0];
    try {
        const appRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
        const appRole = appRoles.find(r => r.roleId === roleId);
        if (!appRole || appRole.enabled === false) {
            return interaction.reply({ embeds: [errorEmbed('Unavailable', 'This application is no longer open.')], flags: ['Ephemeral'] });
        }

        const [settings, roleSettings] = await Promise.all([
            getApplicationSettings(interaction.client, interaction.guild.id),
            getApplicationRoleSettings(interaction.client, interaction.guild.id, roleId),
        ]);

        const eligibilityErrors = await checkEligibility(interaction, roleSettings);
        if (eligibilityErrors.length) {
            return interaction.reply({
                embeds: [new EmbedBuilder().setTitle('❌ Not Eligible').setDescription(eligibilityErrors.join('\n\n')).setColor('#ED4245').setFooter({ text: 'Meet the requirements above to apply' })],
                flags: ['Ephemeral'],
            });
        }

        const cooldownMsg = await checkCooldown(interaction.client, interaction.guild.id, interaction.user.id, roleId, roleSettings.cooldownDays);
        if (cooldownMsg) {
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('⏳ Cooldown Active').setDescription(cooldownMsg).setColor('#FEE75C')], flags: ['Ephemeral'] });
        }

        const userApps = await getUserApplications(interaction.client, interaction.guild.id, interaction.user.id);
        const pendingForRole = userApps.find(a => a.roleId === roleId && a.status === 'pending');
        if (pendingForRole) {
            return interaction.reply({ embeds: [errorEmbed('Already Applied', `You already have a pending application for **${appRole.name}**.\nID: \`${pendingForRole.id}\``)], flags: ['Ephemeral'] });
        }

        const questions = roleSettings.questions?.length
            ? roleSettings.questions
            : (settings.questions ?? ['Why do you want this role?', 'What experience do you have?']);

        const part1 = questions.slice(0, 5);
        const part2 = questions.slice(5, 10);
        const needsTwoParts = part2.length > 0;

        const modal1Id = `appsubmit_p1_${roleId}`;
        await interaction.showModal(buildQuestionModal(modal1Id, `Apply for ${appRole.name}${needsTwoParts ? ' — Part 1 of 2' : ''}`, part1));

        let sub1;
        try {
            sub1 = await interaction.awaitModalSubmit({ time: 10 * 60_000, filter: i => i.customId === modal1Id && i.user.id === interaction.user.id });
        } catch { return; }

        const answers1 = part1.map((q, i) => ({ question: q, answer: sub1.fields.getTextInputValue(`q${i}`) ?? '' }));
        let allAnswers = answers1;
        let finalSub = sub1;

        if (needsTwoParts) {
            const modal2Id = `appsubmit_p2_${roleId}`;
            await sub1.showModal(buildQuestionModal(modal2Id, `Apply for ${appRole.name} — Part 2 of 2`, part2));

            let sub2;
            try {
                sub2 = await sub1.awaitModalSubmit({ time: 10 * 60_000, filter: i => i.customId === modal2Id && i.user.id === interaction.user.id });
            } catch { return; }

            allAnswers = [...answers1, ...part2.map((q, i) => ({ question: q, answer: sub2.fields.getTextInputValue(`q${i}`) ?? '' }))];
            finalSub = sub2;
        }

        await finalSub.deferReply({ flags: ['Ephemeral'] });

        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return finalSub.editReply({ embeds: [errorEmbed('Role no longer exists. Contact an admin.')] });

        const application = await createApplication(interaction.client, {
            guildId: interaction.guild.id,
            userId: interaction.user.id,
            roleId,
            roleName: appRole.name,
            username: interaction.user.tag,
            avatar: interaction.user.displayAvatarURL(),
            answers: allAnswers,
            status: 'pending',
            createdAt: Date.now(),
        });

        await finalSub.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✅ Application Submitted!')
                    .setColor('#57F287')
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                    .setDescription(
                        `> Your application for **${appRole.name}** has been received and is now under review.\n\n` +
                        `📋 **Application ID:** \`${application.id}\`\n` +
                        `📊 **Status:** 🟡 Pending Review\n\n` +
                        `You'll be notified via DM when a decision is made.\n` +
                        `Track your status with \`/application status\``,
                    )
                    .addFields({ name: '📝 Questions Answered', value: `${allAnswers.length}`, inline: true })
                    .setFooter({ text: `${interaction.guild.name} • Application System` })
                    .setTimestamp(),
            ],
        });

        const logChannelId = roleSettings.logChannelId || settings.logChannelId;
        if (!logChannelId) return;
        const logChannel = interaction.guild.channels.cache.get(logChannelId);
        if (!logChannel) return;

        const logEmbed = new EmbedBuilder()
            .setTitle('📋 New Application Received')
            .setColor('#5865F2')
            .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setDescription(`**${interaction.user.tag}** has applied for **${appRole.name}**\n<@${interaction.user.id}> • <@&${roleId}>`)
            .addFields(
                { name: '🆔 Application ID', value: `\`${application.id}\``, inline: true },
                { name: '📊 Status',          value: '🟡 Pending Review',    inline: true },
                { name: '📅 Submitted',        value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                { name: '📅 Account Created',  value: `<t:${Math.floor(interaction.user.createdTimestamp / 1000)}:R>`, inline: true },
            )
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp()
            .setFooter({ text: 'Use the buttons below to Approve, Deny, or Hold' });

        if (roleSettings.bannerUrl || settings.imageUrl) logEmbed.setImage(roleSettings.bannerUrl || settings.imageUrl);

        logEmbed.addFields({ name: '\u200B', value: '─────────── **Answers** ───────────', inline: false });
        allAnswers.forEach((item, i) => {
            logEmbed.addFields({
                name: `❓ Q${i + 1}: ${item.question.length > 80 ? item.question.substring(0, 77) + '...' : item.question}`,
                value: item.answer.trim() || '*No answer provided*',
                inline: false,
            });
        });

        const logButtons = buildLogButtons(application.id, 'pending');
        const logMsg = await logChannel.send({
            content: roleSettings.pingRoleId ? `<@&${roleSettings.pingRoleId}> 📋 New application from **${interaction.user.tag}**!` : undefined,
            embeds: [logEmbed],
            components: logButtons ? [logButtons] : [],
        });

        await updateApplication(interaction.client, interaction.guild.id, application.id, { logMessageId: logMsg.id, logChannelId });

    } catch (err) {
        logger.error('Error in app_role_select', { error: err.message, stack: err.stack });
        try {
            const errEmbed = errorEmbed('Something went wrong', 'Please try again.');
            if (interaction.replied || interaction.deferred) await interaction.followUp({ embeds: [errEmbed], flags: ['Ephemeral'] });
            else await interaction.reply({ embeds: [errEmbed], flags: ['Ephemeral'] });
        } catch { /* ignore */ }
    }
}

async function handleConfigure(interaction) {
    const roleId = interaction.customId.split(':')[1];
    const option = interaction.values[0];

    try {
        if (option === 'toggle') {
            const appRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
            const appRole = appRoles.find(r => r.roleId === roleId);
            if (appRole) appRole.enabled = !appRole.enabled;
            await saveApplicationRoles(interaction.client, interaction.guild.id, appRoles);
            const { embed, selectRow } = await buildConfigPanel(interaction.client, interaction.guild, roleId);
            return interaction.update({ embeds: [embed], components: [selectRow] });
        }

        const modalConfig = {
            questions:        { title: 'Edit Questions (First 5)', fields: [{ id: 'q1', label: 'Question 1 (required)', required: true, placeholder: 'What is your Roblox and Discord username?' }, { id: 'q2', label: 'Question 2', required: false, placeholder: 'Why do you want this role?' }, { id: 'q3', label: 'Question 3', required: false, placeholder: '' }, { id: 'q4', label: 'Question 4', required: false, placeholder: '' }, { id: 'q5', label: 'Question 5', required: false, placeholder: '' }] },
            log_channel:      { title: 'Set Log Channel',          fields: [{ id: 'value', label: 'Channel ID (right-click → Copy ID)', required: true, placeholder: '123456789012345678' }] },
            ping_role:        { title: 'Set Staff Ping Role',       fields: [{ id: 'value', label: 'Role ID or "none" to clear', required: true, placeholder: '123456789012345678' }] },
            banner:           { title: 'Set Banner Image URL',      fields: [{ id: 'value', label: 'Image URL (https:// required)', required: false, placeholder: 'https://i.imgur.com/example.png' }] },
            description:      { title: 'Set Description',           fields: [{ id: 'value', label: 'Description (shown in apply menu)', required: false, placeholder: 'Brief description...' }] },
            required_roles:   { title: 'Required Roles',            fields: [{ id: 'value', label: 'Role IDs (comma-separated) or "none"', required: false, placeholder: '123456789, 987654321' }] },
            blacklisted_roles:{ title: 'Blacklisted Roles',         fields: [{ id: 'value', label: 'Role IDs (comma-separated) or "none"', required: false, placeholder: '123456789, 987654321' }] },
            cooldown:         { title: 'Set Reapply Cooldown',      fields: [{ id: 'value', label: 'Days before denied users can reapply (0 = none)', required: true, placeholder: '7' }] },
            min_age:          { title: 'Set Minimum Account Age',   fields: [{ id: 'value', label: 'Minimum account age in days (0 = none)', required: true, placeholder: '30' }] },
        };

        const config = modalConfig[option];
        if (!config) return;

        const modalId = `appcfg_${option}_${roleId}`;
        const modal = new ModalBuilder().setCustomId(modalId).setTitle(config.title);
        const currentSettings = await getApplicationRoleSettings(interaction.client, interaction.guild.id, roleId);

        config.fields.forEach((field, i) => {
            let currentValue = '';
            if (option === 'questions')         currentValue = currentSettings.questions?.[i] ?? '';
            else if (option === 'log_channel')        currentValue = currentSettings.logChannelId ?? '';
            else if (option === 'ping_role')          currentValue = currentSettings.pingRoleId ?? '';
            else if (option === 'banner')             currentValue = currentSettings.bannerUrl ?? '';
            else if (option === 'description')        currentValue = currentSettings.description ?? '';
            else if (option === 'required_roles')     currentValue = currentSettings.requiredRoles?.join(', ') ?? '';
            else if (option === 'blacklisted_roles')  currentValue = currentSettings.blacklistedRoles?.join(', ') ?? '';
            else if (option === 'cooldown')           currentValue = String(currentSettings.cooldownDays ?? '0');
            else if (option === 'min_age')            currentValue = String(currentSettings.minAccountAgeDays ?? '0');

            const input = new TextInputBuilder()
                .setCustomId(field.id)
                .setLabel(field.label)
                .setStyle(option === 'description' ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(field.required)
                .setMaxLength(option === 'description' ? 300 : 100);

            if (field.placeholder) input.setPlaceholder(field.placeholder);
            if (currentValue) input.setValue(currentValue.substring(0, option === 'description' ? 300 : 100));
            modal.addComponents(new ActionRowBuilder().addComponents(input));
        });

        await interaction.showModal(modal);

        let submitted;
        try {
            submitted = await interaction.awaitModalSubmit({ time: 10 * 60_000, filter: i => i.customId === modalId && i.user.id === interaction.user.id });
        } catch { return; }

        await submitted.deferReply({ flags: ['Ephemeral'] });

        const existing = await getApplicationRoleSettings(interaction.client, interaction.guild.id, roleId);
        const updates = { ...existing };

        if (option === 'questions') {
            updates.questions = ['q1','q2','q3','q4','q5'].map(id => submitted.fields.getTextInputValue(id)?.trim() ?? '').filter(q => q.length > 0);
        } else {
            const raw = submitted.fields.getTextInputValue('value')?.trim() ?? '';
            if (option === 'log_channel')           updates.logChannelId = raw.toLowerCase() === 'none' ? null : raw || null;
            else if (option === 'ping_role')         updates.pingRoleId = raw.toLowerCase() === 'none' ? null : raw || null;
            else if (option === 'banner') {
                if (raw && !raw.startsWith('https://')) return submitted.editReply({ embeds: [errorEmbed('URL must start with `https://`.')] });
                updates.bannerUrl = raw || null;
            }
            else if (option === 'description')       updates.description = raw || null;
            else if (option === 'required_roles')    updates.requiredRoles = raw.toLowerCase() === 'none' ? [] : raw.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
            else if (option === 'blacklisted_roles') updates.blacklistedRoles = raw.toLowerCase() === 'none' ? [] : raw.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
            else if (option === 'cooldown')          updates.cooldownDays = Math.max(0, parseInt(raw) || 0);
            else if (option === 'min_age')           updates.minAccountAgeDays = Math.max(0, parseInt(raw) || 0);
        }

        await saveApplicationRoleSettings(interaction.client, interaction.guild.id, roleId, updates);
        const { embed, selectRow } = await buildConfigPanel(interaction.client, interaction.guild, roleId);

        await submitted.editReply({
            embeds: [new EmbedBuilder().setTitle('✅ Setting Saved').setDescription(`**${option.replace(/_/g, ' ')}** updated.`).setColor('#57F287'), embed],
            components: [selectRow],
        });

    } catch (err) {
        logger.error('Error in app_configure', { error: err.message, stack: err.stack });
        try {
            if (interaction.replied || interaction.deferred) await interaction.followUp({ embeds: [errorEmbed('Something went wrong.')], flags: ['Ephemeral'] });
            else await interaction.reply({ embeds: [errorEmbed('Something went wrong.')], flags: ['Ephemeral'] });
        } catch { /* ignore */ }
    }
}

export default [
    { name: 'app_role_select', execute: handleRoleSelect },
    { name: 'app_configure',   execute: handleConfigure  },
];
