require("dotenv").config();

function requiredEnv(name) {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

module.exports = {
  discordToken: requiredEnv("DISCORD_TOKEN"),
  discordClientId: requiredEnv("DISCORD_CLIENT_ID"),
  discordGuildId: process.env.DISCORD_GUILD_ID?.trim() || null,
  ownerGuildId: process.env.OWNER_GUILD_ID?.trim() || process.env.DISCORD_GUILD_ID?.trim() || null,
  ownerUserIds: (process.env.OWNER_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
  erlcBaseUrl: process.env.ERLC_BASE_URL?.trim() || "https://api.erlc.gg/v2",
  erlcPlayersPath: process.env.ERLC_PLAYERS_PATH?.trim() || "/server/players",
  securityScanIntervalSeconds: Number(process.env.SECURITY_SCAN_INTERVAL_SECONDS || 60)
};
