import { getFromDb, setInDb } from '../utils/database.js';
import { logger } from '../utils/logger.js';

export class WarningService {
  /**
   * Add a warning to a user in a guild.
   */
  static async addWarning({
    guildId,
    userId,
    moderatorId,
    reason,
    timestamp = Date.now()
  }) {
    try {
      const key = `moderation:warnings:${guildId}:${userId}`;
      const warnings = await getFromDb(key, []);

      if (!Array.isArray(warnings)) {
        logger.warn(`Warnings for ${userId} in ${guildId} corrupted, resetting`);
        await setInDb(key, []);
        return { success: false, error: 'Corrupted data' };
      }

      const warning = {
        id: Date.now(),
        guildId,
        userId,
        moderatorId,
        reason,
        timestamp,
        status: 'active'
      };

      warnings.push(warning);
      await setInDb(key, warnings);

      logger.info(`Warning added: ${userId} in ${guildId} by ${moderatorId}`);

      return {
        success: true,
        id: warning.id,
        totalCount: warnings.filter(w => w.status !== 'deleted').length
      };
    } catch (error) {
      logger.error('Error adding warning:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all active warnings for a user in a guild.
   */
  static async getWarnings(guildId, userId) {
    try {
      const key = `moderation:warnings:${guildId}:${userId}`;
      const warnings = await getFromDb(key, []);

      return Array.isArray(warnings)
        ? warnings.filter(w => w && w.status !== 'deleted')
        : [];
    } catch (error) {
      logger.error('Error fetching warnings:', error);
      return [];
    }
  }

  /**
   * Get the count of active warnings for a user in a guild.
   */
  static async getWarningCount(guildId, userId) {
    const warnings = await this.getWarnings(guildId, userId);
    return warnings.length;
  }

  /**
   * Remove a specific warning by ID from a user in a guild.
   */
  static async removeWarning(guildId, userId, warningId) {
    try {
      const key = `moderation:warnings:${guildId}:${userId}`;
      const warnings = await getFromDb(key, []);

      if (!Array.isArray(warnings)) {
        return { success: false, error: 'Invalid warning data structure.' };
      }

      // Use loose equality to handle String vs Number IDs
      const warning = warnings.find(w => w.id == warningId);

      if (!warning) {
        return { success: false, error: 'Warning not found in database.' };
      }

      if (warning.status === 'deleted') {
        return { success: false, error: 'This warning has already been removed.' };
      }

      warning.status = 'deleted';
      await setInDb(key, warnings);

      logger.info(`Warning removed: ${warningId} for ${userId} in ${guildId}`);

      return {
        success: true,
        removedId: warningId
      };
    } catch (error) {
      logger.error('Error removing warning:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear all warnings for a user in a guild.
   */
  static async clearWarnings(guildId, userId) {
    try {
      const key = `moderation:warnings:${guildId}:${userId}`;
      const warnings = await getFromDb(key, []);

      const activeCount = Array.isArray(warnings)
        ? warnings.filter(w => w.status !== 'deleted').length
        : 0;

      await setInDb(key, []);

      logger.info(`Warnings cleared for ${userId} in ${guildId} (${activeCount} removed)`);
      return { success: true, count: activeCount };
    } catch (error) {
      logger.error('Error clearing warnings:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all warnings across a guild (by all users).
   * Note: Requires database to support prefix/list queries.
   */
  static async getGuildWarnings(guildId, filters = {}) {
    try {
      const { limit = 100 } = filters;
      const allWarnings = [];
      logger.debug(`Fetched guild warnings for ${guildId} with ${allWarnings.length} total`);
      return allWarnings.slice(0, limit);
    } catch (error) {
      logger.error('Error fetching guild warnings:', error);
      return [];
    }
  }
}
