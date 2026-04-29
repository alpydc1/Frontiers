import { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import ApplicationService from '../../services/applicationService.js';
import { getApplicationRoles, getApplicationRoleSettings, getApplicationSettings, getUserApplications, updateApplication } from '../../utils/database.js';

export default [
    {
        name: 'app_role_select',
        execute: async interaction => {
            const roleId = interaction.values[0];
            try {
                const appRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
                const appRole = appRoles.find(r => r.roleId === roleId);

                if (!appRole || appRole.enabled === false) {
                    return interaction.reply({ embeds: [errorEmbed('Application Unavailable', 'This application is no longer available.')], flags: ['Ephemeral'] });
                }

                const userApps = await getUserApplications(interaction.client, interaction.guild.id, interaction.user.id);
                const pending = userApps.find(a => a.status === 'pending');
                if (pending) {
                    return interaction.reply({ embeds: [errorEmbed('Application Pending', `You already have a pending application.\nApplication ID: \`${pending.id}\``)], flags: ['Ephemeral'] });
                }

                const settings = await getApplicationSettings(interaction.client, interaction.guild.id);
                const roleSettings = await getApplicationRoleSettings(interaction.client, interaction.guild.id, roleId);
                const questions = (roleSettings.questions?.length ? roleSettings.questions : null) ?? settings.questions ?? ['Why do you want this role?', 'What experience do you have?'];
                const limited = questions.slice(0, 5);

                const modal = new ModalBuilder().setCustomId(`app_submit:${roleId}`).setTitle(`Apply for ${appRole.name}`);
                limited.forEach((q, i) => {
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId(`q${i}`).setLabel(q.length > 45 ? `${q.substring(0, 42)}...` : q).setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(10).setMaxLength(1000),
                        ),
                    );
                });

                await interaction.showModal(modal);

                let submitted;
                try {
                    submitted = await interaction.awaitModalSubmit({ time: 10 * 60 * 1000, filter: i => i.customId === `app_submit:${roleId}` && i.user.id === interaction.user.id });
                } catch { return; }

                await submitted.deferReply({ flags: ['Ephemeral'] });

                const role = interaction.guild.roles.cache.get(roleId);
                if (!role) return submitted.editReply({ embeds: [errorEmbed('Role Gone', 'The role for this application no longer exists.')] });

                const answers = limited.map((question, i) => ({ question, answer: submitted.fields.getTextInputValue(`q${i}`) ?? '' }));

                const application = await ApplicationService.submitApplication(interaction.client, {
                    guildId: interaction.guild.id, userId: interaction.user.id, roleId,
                    roleName: appRole.name, username: interaction.user.tag,
                    avatar: interaction.user.displayAvatarURL(), answers,
                });

                await submitted.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('✅ Application Submitted!')
                            .setDescription(`Your application for **${appRole.name}** has been received and is under review.\n\n**Application ID:** \`${application.id}\`\nCheck your status with \`/application status\``)
                            .setColor(getColor('success') || '#57F287')
                            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                            .setTimestamp(),
                    ],
                });

                const logChannelId = roleSettings.logChannelId || settings.logChannelId;
                if (!logChannelId) return;
                const logChannel = interaction.guild.channels.cache.get(logChannelId);
                if (!logChannel) return;

                const logEmbed = new EmbedBuilder()
                    .setTitle('📝 New Application')
                    .setColor(getColor('warning') || '#FEE75C')
                    .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                    .addFields(
                        { name: '👤 Applicant', value: `<@${interaction.user.id}>`, inline: true },
                        { name: '📋 Application', value: appRole.name, inline: true },
                        { name: '🎭 Role', value: `<@&${roleId}>`, inline: true },
                        { name: '🆔 Application ID', value: `\`${application.id}\``, inline: true },
                        { name: '📊 Status', value: '🟡 Pending Review', inline: true },
                        { name: '📅 Submitted', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                    )
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                    .setTimestamp()
                    .setFooter({ text: 'Use the buttons below to review this application' });

                if (settings.imageUrl) logEmbed.setImage(settings.imageUrl);
                answers.forEach((item, i) => {
                    logEmbed.addFields({ name: `❓ Q${i + 1}: ${item.question}`, value: item.answer.trim() || '*No answer provided*', inline: false });
                });

                const buttons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`app_approve:${application.id}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`app_deny:${application.id}`).setLabel('Deny').setEmoji('❌').setStyle(ButtonStyle.Danger),
                );

                const logMsg = await logChannel.send({ embeds: [logEmbed], components: [buttons] });
                await updateApplication(interaction.client, interaction.guild.id, application.id, { logMessageId: logMsg.id, logChannelId });

            } catch (error) {
                logger.error('Error in app_role_select handler', { error: error.message, userId: interaction.user.id, stack: error.stack });
                const errEmbed = errorEmbed('Something went wrong', 'An error occurred. Please try again.');
                try {
                    if (interaction.replied || interaction.deferred) await interaction.followUp({ embeds: [errEmbed], flags: ['Ephemeral'] });
                    else await interaction.reply({ embeds: [errEmbed], flags: ['Ephemeral'] });
                } catch { }
            }
        },
    },
];
