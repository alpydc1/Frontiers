import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} from 'discord.js';
import { supabase } from '../../lib/supabase.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getLevelingConfig, saveLevelingConfig } from '../../services/leveling.js';

export default {
    data: new SlashCommandBuilder()
        .setName('levelrole')
        .setDescription('Configure which role is assigned when users reach a specific level')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(sub =>
            sub
                .setName('set')
                .setDescription('Link a role to a level (users get this role when they reach that level)')
                .addIntegerOption(opt =>
                    opt.setName('level').setDescription('Level number (1–50)').setMinValue(1).setMaxValue(50).setRequired(true),
                )
                .addRoleOption(opt =>
                    opt.setName('role').setDescription('Role to assign when users reach this level').setRequired(true),
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
            sub.setName('list').setDescription('Show all level → role mappings configured for this server'),
        )
        .addSubcommand(sub =>
            sub.setName('setup').setDescription('Auto-detect Level 1, 5, 10, 15, 20, 25, 30, 40, 50 roles and link them all at once'),
        ),

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferSuccess) return;

            const sub     = interaction.options.getSubcommand();
            const guildId = interaction.guild.id;
            const client  = interaction.client;

            if (sub === 'set') {
                const level = interaction.options.getInteger('level');
                const role  = interaction.options.getRole('role');

                if (role.managed) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [new EmbedBuilder().setDescription('❌ Bot-managed roles cannot be used as level roles.').setColor(getColor('error'))],
                    });
                    return;
                }

                const { error } = await supabase
                    .from('level_roles')
                    .upsert({ guild_id: guildId, level, role_id: role.id }, { onConflict: 'guild_id,level' });

                if (error) {
                    logger.error('levelrole set error:', error);
                    throw new TitanBotError('DB upsert failed', ErrorTypes.DATABASE, 'Failed to save the level role. Please try again.');
                }

                // Also save to guild config so the XP system can read it
                try {
                    const config = await getLevelingConfig(client, guildId);
                    config.roleRewards = config.roleRewards || {};
                    config.roleRewards[level] = role.id;
                    await saveLevelingConfig(client, guildId, config);
                } catch (cfgErr) {
                    logger.warn('Could not sync role to guild config:', cfgErr);
                }

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [new EmbedBuilder()
                        .setDescription(`✅ Users who reach **Level ${level}** will now receive the ${role} role.`)
                        .setColor(getColor('success'))],
                });
                return;
            }

            if (sub === 'remove') {
                const level = interaction.options.getInteger('level');

                const { error } = await supabase
                    .from('level_roles')
                    .delete()
                    .eq('guild_id', guildId)
                    .eq('level', level);

                if (error) {
                    logger.error('levelrole remove error:', error);
                    throw new TitanBotError('DB delete failed', ErrorTypes.DATABASE, 'Failed to remove the level role. Please try again.');
                }

                // Also remove from guild config
                try {
                    const config = await getLevelingConfig(client, guildId);
                    if (config.roleRewards) {
                        delete config.roleRewards[level];
                        await saveLevelingConfig(client, guildId, config);
                    }
                } catch (cfgErr) {
                    logger.warn('Could not sync removal to guild config:', cfgErr);
                }

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [new EmbedBuilder()
                        .setDescription(`✅ Removed the role mapping for **Level ${level}**.`)
                        .setColor(getColor('success'))],
                });
                return;
            }

            if (sub === 'list') {
                const { data: rows, error } = await supabase
                    .from('level_roles')
                    .select('level, role_id')
                    .eq('guild_id', guildId)
                    .order('level', { ascending: true });

                if (error) {
                    logger.error('levelrole list error:', error);
                    throw new TitanBotError('DB read failed', ErrorTypes.DATABASE, 'Failed to fetch level roles. Please try again.');
                }

                if (!rows || rows.length === 0) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [new EmbedBuilder()
                            .setDescription('No level roles configured yet.\nUse `/levelrole set` to link a role to a level.')
                            .setColor(getColor('info'))],
                    });
                    return;
                }

                const lines = rows.map(r => `**Level ${r.level}** → <@&${r.role_id}>`);
                const embed = new EmbedBuilder()
                    .setTitle('Level Role Rewards')
                    .setDescription(lines.join('\n'))
                    .setColor(getColor('primary'))
                    .setFooter({ text: `${rows.length} level${rows.length === 1 ? '' : 's'} configured` });

                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
                return;
            }

            if (sub === 'setup') {
                const MILESTONE_LEVELS = [1, 5, 10, 15, 20, 25, 30, 40, 50];
                const matched    = [];
                const missing    = [];
                const upsertRows = [];

                for (const level of MILESTONE_LEVELS) {
                    const roleName = `Level ${level}`;
                    const role = interaction.guild.roles.cache.find(r => r.name === roleName && !r.managed);
                    if (role) {
                        matched.push({ level, role });
                        upsertRows.push({ guild_id: guildId, level, role_id: role.id });
                    } else {
                        missing.push(level);
                    }
                }

                if (upsertRows.length > 0) {
                    const { error } = await supabase
                        .from('level_roles')
                        .upsert(upsertRows, { onConflict: 'guild_id,level' });

                    if (error) {
                        logger.error('levelrole setup upsert error:', error);
                        throw new TitanBotError('DB upsert failed', ErrorTypes.DATABASE, 'Failed to save level roles. Please try again.');
                    }

                    // Also save all matched roles to guild config
                    try {
                        const config = await getLevelingConfig(client, guildId);
                        config.roleRewards = config.roleRewards || {};
                        for (const { level, role } of matched) {
                            config.roleRewards[level] = role.id;
                        }
                        await saveLevelingConfig(client, guildId, config);
                    } catch (cfgErr) {
                        logger.warn('Could not sync setup roles to guild config:', cfgErr);
                    }
                }

                const lines = matched.map(({ level, role }) => `✅ **Level ${level}** → ${role}`);
                if (missing.length > 0) {
                    lines.push(`\n⚠️ Roles not found (create them with these exact names):\n${missing.map(l => `• \`Level ${l}\``).join('\n')}`);
                }

                const embed = new EmbedBuilder()
                    .setTitle('Level Role Setup')
                    .setDescription(lines.join('\n') || 'No matching roles found.')
                    .setColor(matched.length > 0 ? getColor('success') : getColor('error'))
                    .setFooter({ text: `${matched.length} role${matched.length === 1 ? '' : 's'} linked` });

                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
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
