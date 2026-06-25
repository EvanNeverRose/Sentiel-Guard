const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "db.json");

const initialData = {
  guilds: {},
  blacklist: {},
  whitelist: {},
  reports: [],
  appeals: []
};

let state = load();

function load() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) return structuredClone(initialData);

  const parsed = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  return {
    ...structuredClone(initialData),
    ...parsed,
    guilds: parsed.guilds || {},
    blacklist: parsed.blacklist || {},
    whitelist: parsed.whitelist || {},
    reports: parsed.reports || [],
    appeals: parsed.appeals || []
  };
}

function save() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(state, null, 2));
}

function defaultGuildSettings(guildId) {
  return {
    guildId,
    alertChannelId: null,
    reportChannelId: null,
    appealChannelId: null,
    auditLogChannelId: null,
    investigationRoleId: null,
    serverStaffRoleId: null,
    globalStaffRoleId: null,
    erlcServerKey: null,
    punishments: {
      low: "warn",
      medium: "ask",
      high: "ban"
    },
    lastSeenRobloxIds: []
  };
}

function getGuildSettings(guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = defaultGuildSettings(guildId);
    save();
  }

  return state.guilds[guildId];
}

function updateGuildSettings(guildId, patch) {
  const existing = getGuildSettings(guildId);
  state.guilds[guildId] = {
    ...existing,
    ...patch,
    punishments: {
      ...existing.punishments,
      ...(patch.punishments || {})
    }
  };
  save();
  return state.guilds[guildId];
}

function identityKeys(identity) {
  const discordIds = [...new Set([identity.discordId, ...(identity.discordIds || [])].filter(Boolean))];
  const robloxIds = [...new Set([identity.robloxId, ...(identity.robloxIds || [])].filter(Boolean))];

  return [
    ...discordIds.map((id) => `discord:${id}`),
    ...robloxIds.map((id) => `roblox:${id}`)
  ];
}

function guildIdentityKeys(guildId, { discordId, robloxId }) {
  return identityKeys({ discordId, robloxId }).map((key) => `${guildId}:${key}`);
}

function addBlacklist(entry) {
  const now = new Date().toISOString();
  const id = entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    discordId: entry.discordId || null,
    robloxId: entry.robloxId || null,
    discordIds: [...new Set([entry.discordId, ...(entry.discordIds || [])].filter(Boolean))],
    robloxIds: [...new Set([entry.robloxId, ...(entry.robloxIds || [])].filter(Boolean))],
    reason: entry.reason,
    securityLevel: entry.securityLevel,
    proof: entry.proof || null,
    createdBy: entry.createdBy,
    createdAt: now
  };

  for (const key of identityKeys(record)) state.blacklist[key] = record;
  save();
  return record;
}

function removeBlacklist({ discordId, robloxId }) {
  let removed = false;
  const entry = findBlacklist({ discordId, robloxId });
  const keys = entry ? identityKeys(entry) : identityKeys({ discordId, robloxId });

  for (const key of keys) {
    if (state.blacklist[key]?.id === entry?.id || !entry) {
      delete state.blacklist[key];
      removed = true;
    }
  }
  save();
  return removed;
}

function findBlacklist({ discordId, robloxId }) {
  for (const key of identityKeys({ discordId, robloxId })) {
    if (state.blacklist[key]) return state.blacklist[key];
  }
  return null;
}

function listBlacklist() {
  return [...new Map(Object.values(state.blacklist).map((entry) => [entry.id, entry])).values()];
}

function findBlacklistByCaseId(caseId) {
  return listBlacklist().find((entry) => entry.id === caseId) || null;
}

function updateBlacklist(caseId, patch) {
  const existing = findBlacklistByCaseId(caseId);
  if (!existing) return null;

  for (const key of identityKeys(existing)) delete state.blacklist[key];

  const updated = {
    ...existing,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined && value !== null && value !== "")),
    id: existing.id,
    updatedAt: new Date().toISOString()
  };

  updated.discordIds = [...new Set([
    existing.discordId,
    ...(existing.discordIds || []),
    patch.discordId
  ].filter(Boolean))];
  updated.robloxIds = [...new Set([
    existing.robloxId,
    ...(existing.robloxIds || []),
    patch.robloxId
  ].filter(Boolean))];
  updated.discordId = updated.discordIds[0] || null;
  updated.robloxId = updated.robloxIds[0] || null;

  for (const key of identityKeys(updated)) state.blacklist[key] = updated;
  save();
  return updated;
}

function addWhitelist(guildId, entry) {
  const record = {
      guildId,
      discordId: entry.discordId || null,
      robloxId: entry.robloxId || null,
      reason: entry.reason || "No reason provided",
      createdBy: entry.createdBy,
      createdAt: new Date().toISOString()
    };

  for (const key of guildIdentityKeys(guildId, record)) state.whitelist[key] = record;
  save();
  return record;
}

function removeWhitelist(guildId, { discordId, robloxId }) {
  let removed = false;
  for (const key of guildIdentityKeys(guildId, { discordId, robloxId })) {
    if (state.whitelist[key]) {
      delete state.whitelist[key];
      removed = true;
    }
  }
  save();
  return removed;
}

function findWhitelist(guildId, { discordId, robloxId }) {
  for (const key of guildIdentityKeys(guildId, { discordId, robloxId })) {
    if (state.whitelist[key]) return state.whitelist[key];
  }
  return null;
}

function addReport(report) {
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...report,
    createdAt: new Date().toISOString()
  };
  state.reports.push(record);
  save();
  return record;
}

function addAppeal(appeal) {
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...appeal,
    status: "open",
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
    createdAt: new Date().toISOString()
  };
  state.appeals.push(record);
  save();
  return record;
}

function findAppeal(appealId) {
  return state.appeals.find((appeal) => appeal.id === appealId) || null;
}

function updateAppeal(appealId, patch) {
  const appeal = findAppeal(appealId);
  if (!appeal) return null;

  Object.assign(appeal, patch);
  save();
  return appeal;
}

function getAllGuildSettings() {
  return Object.values(state.guilds);
}

module.exports = {
  addAppeal,
  addBlacklist,
  addReport,
  addWhitelist,
  findAppeal,
  findBlacklist,
  findBlacklistByCaseId,
  findWhitelist,
  getAllGuildSettings,
  getGuildSettings,
  listBlacklist,
  removeBlacklist,
  removeWhitelist,
  updateAppeal,
  updateBlacklist,
  updateGuildSettings
};
