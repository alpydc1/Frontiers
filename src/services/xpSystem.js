import { logger } from '../utils/logger.js';
import { getLevelingConfig, getXpForLevel, getUserLevelData, saveUserLevelData } from './leveling.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';
import { supabase } from '../lib/supabase.js';

export async function addXp(client, guild, member, xpToAdd) {
  try {
    
    if (!xpToAdd || xpToAdd <= 0) {
      return { success: false, reason: 'Invalid XP amount' };
    }

    const config = await getLevelingConfig(client, guild.id);
    
    if (!config.enabled) {
      return { success: false, reason: 'Leveling is disabled in this server' };
    }
    
    const levelData = await getUserLevelData(client, guild.id, member.user.id);
    
    levelData.xp += xpToAdd;
    levelData.totalXp += xpToAdd;
    levelData.lastMessage = Date.now();
    
    const xpNeededForNextLevel = getXpForLevel(levelData.level + 1);
    let didLevelUp = false;
    
    if (levelData.xp >= xpNeededForNextLevel) {
      levelData.level += 1;
      levelData.xp = levelData.xp - xpNeededForNextLevel;
      didLevelUp = true;
      
      logger.info(`🎉 ${member.user.tag} leveled up to level ${levelData.level} in ${guild.name}`);
      
      try {
        const { data: levelRole } = await supabase
          .from('level_roles')
          .select('role_id')
          .eq('guild_id', guild.id)
          .eq('level', levelData.level)
          .single();

        if (levelRole?.role_id) {
          await awardRoleReward(guild, member, levelRole.role_id, levelData.level);
        }
      } catch (roleError) {
        logger.error('Error fetching level role from Supabase:', roleError);
      }
      
      if (config.announceLevelUp) {
        await sendLevelUpAnnouncement(guild, member, levelData, config);
      }

      try {
        await logEvent({
          client,
          guildId: guild.id,
          eventType: EVENT_TYPES.LEVELING_LEVELUP,
          data: {
            description: `${member.user.tag} reached level ${levelData.level}`,
            userId: member.user.id,
            fields: [
              {
                name: '👤 Member',
                value: `${member.user.tag} (${member.user.id})`,
                inline: true
              },
              {
                name: '📊 New Level',
                value: levelData.level.toString(),
                inline: true
              },
              {
                name: '✨ Total XP',
                value: levelData.totalXp.toString(),
                inline: true
              }
            ]
          }
        });
      } catch {
      }
    }
    
    await saveUserLevelData(client, guild.id, member.user.id, levelData);
    
    return {
      success: true,
      level: levelData.level,
      xp: levelData.xp,
      totalXp: levelData.totalXp,
      xpNeeded: getXpForLevel(levelData.level + 1),
      leveledUp: didLevelUp
    };
    
  } catch (error) {
    logger.error('Error adding XP:', error);
    return { success: false, error: error.message };
  }
}

async function awardRoleReward(guild, member, roleId, level) {
  try {
    const role = guild.roles.cache.get(roleId);
    
    if (!role) {
      logger.warn(`Role ${roleId} not found for level ${level} reward in guild ${guild.id}`);
      return;
    }

    if (member.roles.cache.has(roleId)) {
      return;
    }

    await member.roles.add(role, `Level ${level} reward`);
    logger.info(`✅ Awarded role ${role.name} to ${member.user.tag} for reaching level ${level}`);
  } catch (error) {
    logger.error(`Failed to award role reward to ${member.user.id}:`, error);
  }
}

function getLevelColor(level) {
  if (level >= 100) return '#F4D03F';
  if (level >= 75)  return '#A569BD';
  if (level >= 50)  return '#5DADE2';
  if (level >= 25)  return '#48C9B0';
  if (level >= 10)  return '#58D68D';
  return '#BDC3C7';
}

function getLevelBadge(level) {
  if (level >= 100) return '👑';
  if (level >= 75)  return '💎';
  if (level >= 50)  return '🔥';
  if (level >= 25)  return '⚡';
  if (level >= 10)  return '🌟';
  return '🌱';
}

function getTierLabel(level) {
  if (level >= 100) return 'Legendary';
  if (level >= 75)  return 'Diamond';
  if (level >= 50)  return 'Platinum';
  if (level >= 25)  return 'Gold';
  if (level >= 10)  return 'Silver';
  return 'Bronze';
}

function createLevelProgressBar(current, max, length = 14) {
  const pct = max > 0 ? Math.min(current / max, 1) : 0;
  const filled = Math.round(pct * length);
  const bar = '█'.repeat(filled) + '░'.repeat(length - filled);
  return `\`${bar}\` ${Math.floor(pct * 100)}%`;
}

function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

async function sendLevelUpAnnouncement(guild, member, levelData, config) {
  try {
    const levelUpChannel = config.levelUpChannel
      ? guild.channels.cache.get(config.levelUpChannel)
      : guild.systemChannel;

    if (!levelUpChannel || !levelUpChannel.isTextBased()) return;

    const permissions = levelUpChannel.permissionsFor(guild.members.me);
    if (!permissions || !permissions.has(['SendMessages', 'EmbedLinks'])) {
      logger.warn(`Missing permissions to send levelup message in ${levelUpChannel.id}`);
      return;
    }

    const { EmbedBuilder } = await import('discord.js');

    const level    = levelData.level;
    const xpNow    = levelData.xp;
    const xpNeeded = getXpForLevel(level + 1);
    const totalXp  = levelData.totalXp;
    const color    = getLevelColor(level);
    const badge    = getLevelBadge(level);
    const tier     = getTierLabel(level);
    const bar      = createLevelProgressBar(xpNow, xpNeeded);

    const customMsg = (config.levelUpMessage || '{user} leveled up to level {level}!')
      .replace(/{user}/g, member.displayName)
      .replace(/{level}/g, level)
      .replace(/{xp}/g, fmtNum(xpNow))
      .replace(/{xpNeeded}/g, fmtNum(xpNeeded));

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${badge}  Level Up!`)
      .setDescription(
        `> ${customMsg}\n` +
        `> **Tier Reached:** ${tier}`
      )
      .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: '🎚️ New Level',  value: `**${level}**`,                                      inline: true },
        { name: '✨ Total XP',   value: `**${fmtNum(totalXp)}**`,                             inline: true },
        { name: '⭐ Next Level', value: `**${fmtNum(xpNow)}** / ${fmtNum(xpNeeded)}`,        inline: true },
        { name: `Progress to Level ${level + 1}`, value: bar },
      )
      .setFooter({
        text: guild.name,
        iconURL: guild.iconURL({ dynamic: true }) ?? undefined,
      })
      .setTimestamp();

    await levelUpChannel.send({ content: `${member}`, embeds: [embed] }).catch(err => {
      logger.error(`Failed to send level up message in channel ${levelUpChannel.id}:`, err);
    });
  } catch (error) {
    logger.error('Error sending level up announcement:', error);
  }
}
