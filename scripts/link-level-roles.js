import 'dotenv/config';
import { initializeDatabase } from '../src/utils/database.js';
import { getGuildConfig, setGuildConfig } from '../src/services/guildConfig.js';

const guildId = process.env.GUILD_ID;

if (!guildId) {
  console.error('Missing GUILD_ID in .env');
  process.exit(1);
}

const roleRewards = {
  50: '1486749881866649630',
  40: '1486749883925925938',
  30: '1486749886371201024',
  25: '1486749889584042166',
  20: '1486749891605565633',
  15: '1486749893526687865',
  10: '1486749895544016988',
  5: '1486749898211594362',
  1: '1486749900405342430'
};

const defaultLeveling = {
  enabled: true,
  xpPerMessage: { min: 15, max: 25 },
  xpCooldown: 20,
  levelUpMessage: '{user} has leveled up to level {level}!',
  levelUpChannel: null,
  ignoredChannels: [],
  ignoredRoles: [],
  blacklistedUsers: [],
  roleRewards: {},
  keepHighestLevelRole: true,
  announceLevelUp: true,
  xpMultiplier: 1
};

const { db } = await initializeDatabase();
const client = { db };

const config = await getGuildConfig(client, guildId);

config.leveling = {
  ...defaultLeveling,
  ...(config.leveling || {}),
  roleRewards: {
    ...(config.leveling?.roleRewards || {}),
    ...roleRewards
  },
  keepHighestLevelRole: true
};

await setGuildConfig(client, guildId, config);

console.log('Level roles linked successfully:');
console.table(roleRewards);

process.exit(0);
