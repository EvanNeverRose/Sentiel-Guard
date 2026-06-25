const { securityScanIntervalSeconds } = require("./config");
const { getAllGuildSettings, updateGuildSettings } = require("./database");
const { fetchServerPlayers } = require("./erlcClient");
const { handleRobloxPlayer } = require("./security");

function startErlcScanner(client) {
  const intervalMs = Math.max(30, securityScanIntervalSeconds) * 1000;

  setInterval(async () => {
    for (const settings of getAllGuildSettings()) {
      if (!settings.erlcServerKey) continue;

      const guild = await client.guilds.fetch(settings.guildId).catch(() => null);
      if (!guild) continue;

      const players = await fetchServerPlayers(settings.erlcServerKey).catch((error) => {
        console.error(`ER:LC scan failed for guild ${settings.guildId}:`, error.message);
        return [];
      });

      const previous = new Set(settings.lastSeenRobloxIds || []);
      const current = [];

      for (const player of players) {
        const robloxId = String(player.Id || player.id || player.UserId || player.userId || player.RobloxId || "");
        if (!robloxId) continue;
        current.push(robloxId);
        if (!previous.has(robloxId)) await handleRobloxPlayer(guild, player, settings);
      }

      updateGuildSettings(settings.guildId, { lastSeenRobloxIds: current });
    }
  }, intervalMs);
}

module.exports = {
  startErlcScanner
};
