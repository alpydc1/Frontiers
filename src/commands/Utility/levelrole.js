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

let _supabase = null;
async function getSupabase() {
    if (_supabase) return _supabase;
    try {
        const mod = await import('../../lib/supabase.js');
        _supabase = mod.supabase ?? mod.default?.supabase ?? mod.default ?? null;
        if (!_supabase || typeof _supabase.from !== 'function') {
            throw new TitanBotError(
                'Supabase client could not be resolved from lib/supabase.js',
                ErrorTypes.DATABASE,
                'Database connection unavailable. Please contact an administrator.',
            );
        }
        return _supabase;
    } catch (err) {
        if (err instanceof TitanBotError) throw err;
        throw new TitanBotError(
            `Failed to load supabase client: ${err.message}`,
            ErrorTypes.DATABASE,
            'Database connection unavailable. Please contact an administrator.',
        );
    }
}

async function syncToGuildConfig(client, guildId, updates) {
    try {
        const { getGuildConfig, setGuildConfig } = await import('../../services/guildConfig.js');
        const guildConfig = await getGuildConfig(client, guildId);
        if (!guildConfig.leveling) guildConfig.leveling = {};
        if (!guildConfig.leveling.roleRewards) guildConfig.leveling.roleRewards = {};
        Object.assign(guildConfig.leveling.roleRewards, updates);
        await setGuildConfig(client, guildId, guildConfig);
    } catch (err) {
        logger.warn('Could not sync role rewards to guild config:', err);
    }
}

async function removeFromGuildConfig(client, guildId, level) {
    try {
        const { getGuildConfig, setGuildConfig } = await import('../../services/guildConfig.js');
        const guildConfig = await getGuildConfig(client, guildId);
        if (guildConfig.leveling?.roleRewards) {
            delete guildConfig.leveling.roleRewards[level];
            await setGuildConfig(client, guildId, guildConfig);
        }
    } catch (err) {
        logger.warn('Could not remove role reward from guild config:', err);
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('levelrole')
        .setDescription('Configure which role is assigned when users reach a specific level')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
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
            sub.setName('list').setDescription('Show all level → role mappings for this server'),
        )
        .addSubcommand(sub =>
            sub.setName('setup').setDescription('Auto-detect Level 1, 5, 10, 15, 20, 25, 30, 40, 50 roles and link them'),
        )
        .addSubcommand(sub =>
            sub.setName('link').setDescription('Scan all roles named "Level X" and activate auto-role rewards'),
