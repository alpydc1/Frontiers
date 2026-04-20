import {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
} from 'discord.js';
import { supabase } from '../../lib/supabase.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Set your AFK status — you will be marked as away until you send a message')
        .addStringOption(opt =>
            opt
                .setName('reason')
                .setDescription('Optional reason for going AFK')
                .setMaxLength(200)
                .setRequired(false),
        ),

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction, {
                flags: MessageFlags.Ephemeral,
            });
            if (!deferSuccess) return;

            const reason   = interaction.options.getString('reason')?.trim() || '';
            const userId   = interaction.user.id;
            const guildId  = interaction.guild.id;

            const { data: existing, error: fetchError } = await supabase
                .from('afk_users')
                .select('id')
                .eq('user_id', userId)
                .eq('guild_id', guildId)
                .maybeSingle();

            if (fetchError) {
                logger.error('AFK fetch error:', fetchError);
                throw new TitanBotError('Database read failed', ErrorTypes.DATABASE, 'Failed to check your AFK status. Please try again.');
            }

            if (existing) {
                const { error: deleteError } = await supabase
                    .from('afk_users')
                    .delete()
                    .eq('user_id', userId)
                    .eq('guild_id', guildId);

                if (deleteError) {
                    logger.error('AFK delete error:', deleteError);
                    throw new TitanBotError('Database delete failed', ErrorTypes.DATABASE, 'Failed to remove your AFK status. Please try again.');
                }

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        new EmbedBuilder()
                            .setDescription('✅ Your AFK status has been removed.')
                            .setColor(getColor('success')),
                    ],
                });
                return;
            }

            const { error: insertError } = await supabase
                .from('afk_users')
                .insert({ user_id: userId, guild_id: guildId, reason });

            if (insertError) {
                logger.error('AFK insert error:', insertError);
                throw new TitanBotError('Database insert failed', ErrorTypes.DATABASE, 'Failed to set your AFK status. Please try again.');
            }

            const embed = new EmbedBuilder()
                .setDescription(
                    reason
                        ? `💤 You are now AFK.\n**Reason:** ${reason}`
                        : '💤 You are now AFK.',
                )
                .setColor(getColor('info'))
                .setFooter({ text: 'You will be removed from AFK automatically when you send a message.' });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in /afk:', error);
            throw new TitanBotError(
                `afk command failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Something went wrong setting your AFK status.',
            );
        }
    },
};
