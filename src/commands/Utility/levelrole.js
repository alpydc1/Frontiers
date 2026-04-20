import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} from 'discord.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

async function getRoleRewards(client, guildId) {
    const { getGuildConfig } = await import('../../services/guildConfig.js');
    const guildConfig = await getGuildConfig(client, guildId);
    return guildConfig.leveling?.roleRewards || {};
}

async function setRoleRewards(client, guildId, roleRewards) {
    const { getGuildConfig, setGuildConfig } = await import('../../services/guildConfig.js');
    const guildConfig = await getGuildConfig(client, guildId);
    if (!guildConfig.leveling) guildConfig.leveling = {};
    guildConfig.leveling.roleRewards = { ...(guildConfig.leveling.roleRewards || {}), ...roleRewards };
    await setGuildConfig(client, guildId, guildConfig);
}

async function deleteRoleReward(client, guildId, level) {
    const { getGuildConfig, setGuildConfig } = await import('../../services/guildConfig.js');
    const guildConfig = await getGuildConfig(client, guildId);
    if (guildConfig.leveling?.roleRewards) {
        delete guildConfig.leveling.roleRewards[String(level)];
        delete guildConfig.leveling.roleRewards[Number(level)];
        await setGuildConfig(client, guildId, guildConfig);
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('levelrole')
        .setDescription('Configure which role is assigned when users reach a specific level')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(sub =>
            sub
                .setName('link')
                .setDescription('Scan all roles named "Level X" and activate auto-role rewards'),
        )
        .addSubcommand(sub =>
            sub
                .setName('set')
                .setDescription('Link a role to a level')
                .addIntegerOption(opt =>
                    opt.setName('level').setDescription('Level number (1–50)').setMinValue(1).setMaxValue(50).setRequired(true),
                )
                .addRoleOption(opt =>
                    opt.setName('role').setDescription('Role to assign at this level').setRequired(true),
                ),
        )
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('Remove the role linked to a level')
                .addIntegerOption(opt =>
                    opt.setName('level').setDescription('Level number (1–50)').setMinValue(1).setMaxValue(50).setRequired(true),
                ),
        )
        .addSubcommand(sub =>
            sub.setName('list').setDescription('Show all level to role mappings for this server'),
        )
        .addSubcommand(sub =>
            sub.setName('setup').setDescription('Auto-detect Level 1, 5, 10, 15, 20, 25, 30, 40, 50 roles and link them'),
        ),

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferSuccess) return;

            const sub    = interaction.options.getSubcommand();
            const guildId = interaction.guild.id;
            const client  = interaction.client;

            if (sub === 'link') {
                const levelPattern = /^Level\s+(\d+)$/i;
                const matched    = [];
                const rewardMap  = {};

                for (const [, role] of interaction.guild.roles.cache) {
                    if (role.managed) continue;
                    const match = role.name.match(levelPattern);
                    if (!match) continue;
                    const level = parseInt(match[1], 10);
                    if (level < 1 || level > 1000) continue;
                    matched.push({ level, role });
                    rewardMap[level] = role.id;
                }

                if (matched.length === 0) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [new EmbedBuilder()
                            .setDescription('❌ No roles named "Level X" found.\nRoles must be named exactly like: `Level 1`, `Level 5`, `Level 10`, etc.')
                            .setColor(getColor('error'))],
                    });
                    return;
                }

                matched.sort((a, b) => a.level - b.level);

                await setRoleRewards(client, guildId, rewardMap);

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [new EmbedBuilder()
                        .setTitle('Level Roles Linked')
                        .setDescription(matched.map(({ level, role }) => `✅ **Level ${level}** → ${role}`).join('\n'))
                        .setColor(getColor('success'))
                        .setFooter({ text: `${matched.length} role${matched.length === 1 ? '' : 's'} activated — users will auto-receive these on level up` })],
                });
                return;
            }

            if (sub === 'set') {
                const level = interaction.options.getInteger('level');
                const role  = interaction.options.getRole('role');

                if (role.managed) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [new EmbedBuilder()
                            .setDescription('❌ Bot-managed roles cannot be used as level roles.')
                            .setColor(getColor('error'))],
                    });
                    return;
                }

                await setRoleRewards(client, guildId, { [level]: role.id });

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [new EmbedBuilder()
                        .setDescription(`✅ Users who reach **Level ${level}** will now receive the ${role} role.`)
                        .setColor(getColor('success'))],
                });
                return;
            }

            if (sub === 'remove') {
                const level = interaction.options.getInteger('level');
                await deleteRoleReward(client, guildId, level);

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [new EmbedBuilder()
                        .setDescription(`✅ Removed the role mapping for **Level ${level}**.`)
                        .setColor(getColor('success'))],
                });
                return;
            }

            if (sub === 'list') {
                const roleRewards = await getRoleRewards(client, guildId);
                const entries = Object.entries(roleRewards)
                    .map(([lvl, roleId]) => ({ level: Number(lvl), roleId }))
                    .sort((a, b) => a.level - b.level);

                if (entries.length === 0) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [new EmbedBuilder()
                            .setDescription('No level roles configured yet.\nUse `/levelrole link` to auto-link all your Level roles.')
                            .setColor(getColor('info'))],
                    });
                    return;
                }

                const lines = entries.map(({ level, roleId }) => `**Level ${level}** → <@&${roleId}>`);
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [new EmbedBuilder()
                        .setTitle('Level Role Rewards')
                        .setDescription(lines.join('\n'))
                        .setColor(getColor('primary'))
                        .setFooter({ text: `${entries.length} level${entries.length === 1 ? '' : 's'} configured` })],
                });
                return;
            }

            if (sub === 'setup') {
                const MILESTONE_LEVELS = [1, 5, 10, 15, 20, 25, 30, 40, 50];
                const matched   = [];
                const missing   = [];
                const rewardMap = {};

                for (const level of MILESTONE_LEVELS) {
                    const role = interaction.guild.roles.cache.find(r => r.name === `Level ${level}` && !r.managed);
                    if (role) {
                        matched.push({ level, role });
                        rewardMap[level] = role.id;
                    } else {
                        missing.push(level);
                    }
                }

                if (matched.length > 0) {
                    await setRoleRewards(client, guildId, rewardMap);
                }

                const lines = matched.map(({ level, role }) => `✅ **Level ${level}** → ${role}`);
                if (missing.length > 0) {
                    lines.push(`\n⚠️ Roles not found:\n${missing.map(l => `• \`Level ${l}\``).join('\n')}`);
                }

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [new EmbedBuilder()
                        .setTitle('Level Role Setup')
                        .setDescription(lines.join('\n') || 'No matching roles found.')
                        .setColor(matched.length > 0 ? getColor('success') : getColor('error'))
                        .setFooter({ text: `${matched.length} role${matched.length === 1 ? '' : 's'} linked` })],
                });
                return;
            }

        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in /levelrole:', error);
            throw new TitanBotError(
                `levelrole command failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Something went wrong. Please try again.',
            );
        }
    },
};
