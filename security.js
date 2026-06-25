const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");
const { addWhitelist, findBlacklist, findWhitelist, getGuildSettings } = require("./database");
const { runServerCommand } = require("./erlcClient");

const SECURITY_LEVELS = ["low", "medium", "high"];
const PUNISHMENTS = ["warn", "ask", "role", "kick", "ban", "erlc-kick", "erlc-ban", "none"];

function normalizeId(value) {
  return value?.trim() || null;
}

function validateIdentity(discordId, robloxId) {
  if (!normalizeId(discordId) && !normalizeId(robloxId)) {
    return "A Discord ID or Roblox ID is required.";
  }

  return null;
}

function securityEmbed(entry, targetLabel, guildName) {
  return new EmbedBuilder()
    .setColor(colorForLevel(entry.securityLevel))
    .setTitle(`Security match: ${entry.securityLevel.toUpperCase()}`)
    .setDescription(`${targetLabel} matched the shared blacklist in ${guildName}.`)
    .addFields(
      { name: "Case ID", value: entry.id || "Unknown", inline: true },
      { name: "Security Level", value: entry.securityLevel || "Unknown", inline: true },
      { name: "Discord IDs", value: formatIds(entry.discordIds, entry.discordId), inline: true },
      { name: "Roblox IDs", value: formatIds(entry.robloxIds, entry.robloxId), inline: true },
      { name: "Reason", value: entry.reason || "No reason provided" }
    )
    .setTimestamp();
}

function formatIds(ids = [], fallback) {
  const values = [...new Set([...(ids || []), fallback].filter(Boolean))];
  return values.length ? values.join(", ") : "Not provided";
}

function colorForLevel(level) {
  if (level === "high") return 0xff3b30;
  if (level === "medium") return 0xffcc00;
  return 0x2f80ed;
}

async function getAlertChannel(guild, settings) {
  const channelId = settings.alertChannelId || settings.reportChannelId;
  if (channelId) {
    const configured = await guild.channels.fetch(channelId).catch(() => null);
    if (configured?.isTextBased()) return configured;
  }

  return guild.systemChannel?.isTextBased() ? guild.systemChannel : null;
}

async function handleDiscordMember(member) {
  const settings = getGuildSettings(member.guild.id);
  const entry = findBlacklist({ discordId: member.id });
  if (!entry) return;
  if (findWhitelist(member.guild.id, { discordId: member.id })) return;

  const punishment = settings.punishments[entry.securityLevel] || defaultPunishment(entry.securityLevel);
  const alertChannel = await getAlertChannel(member.guild, settings);
  const embed = securityEmbed(entry, `<@${member.id}>`, member.guild.name);

  if (punishment === "none") return;
  if (punishment === "warn") {
    await alertChannel?.send({ content: `<@${member.id}> joined and is blacklisted.`, embeds: [embed] });
    return;
  }

  if (punishment === "ask") {
    await alertChannel?.send({
      content: `Staff review needed for <@${member.id}>.`,
      embeds: [embed],
      components: [discordReviewRow(member.id)]
    });
    return;
  }

  if (punishment === "role") {
    await giveInvestigationRole(member, settings);
    await alertChannel?.send({ content: `Investigation role applied to <@${member.id}>.`, embeds: [embed] });
    return;
  }

  if (punishment === "kick") {
    await member.kick(`Blacklisted: ${entry.reason}`).catch(() => null);
    await alertChannel?.send({ content: `Kicked <@${member.id}> because they are blacklisted.`, embeds: [embed] });
    return;
  }

  if (punishment === "ban") {
    await member.ban({ reason: `Blacklisted: ${entry.reason}` }).catch(() => null);
    await alertChannel?.send({ content: `Banned <@${member.id}> because they are blacklisted.`, embeds: [embed] });
  }
}

async function handleRobloxPlayer(guild, player, settings) {
  const robloxId = String(player.Id || player.id || player.UserId || player.userId || player.RobloxId || "");
  const robloxName = player.Player || player.Name || player.name || player.Username || robloxId;
  if (!robloxId) return;

  const entry = findBlacklist({ robloxId });
  if (!entry) return;
  if (findWhitelist(guild.id, { robloxId })) return;

  const punishment = settings.punishments[entry.securityLevel] || defaultPunishment(entry.securityLevel);
  const alertChannel = await getAlertChannel(guild, settings);
  const embed = securityEmbed(entry, `Roblox ${robloxName} (${robloxId})`, guild.name);

  if (punishment === "none") return;
  if (punishment === "ask") {
    await alertChannel?.send({
      content: `Staff review needed for blacklisted Roblox account: **${robloxName}**.`,
      embeds: [embed],
      components: [robloxReviewRow(robloxId)]
    });
    return;
  }

  if (punishment === "warn" || punishment === "role" || punishment === "kick" || punishment === "ban") {
    await alertChannel?.send({
      content: `Blacklisted Roblox account joined ER:LC: **${robloxName}**.`,
      embeds: [embed],
      components: [robloxReviewRow(robloxId)]
    });
    return;
  }

  if (punishment === "erlc-kick") {
    await runServerCommand(settings.erlcServerKey, `:kick ${robloxName} Blacklisted: ${entry.reason}`).catch(() => null);
    await alertChannel?.send({ content: `Sent ER:LC kick for **${robloxName}**.`, embeds: [embed] });
    return;
  }

  if (punishment === "erlc-ban") {
    await runServerCommand(settings.erlcServerKey, `:ban ${robloxName} Blacklisted: ${entry.reason}`).catch(() => null);
    await alertChannel?.send({ content: `Sent ER:LC ban for **${robloxName}**.`, embeds: [embed] });
  }
}

function discordReviewRow(memberId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`security:role:discord:${memberId}`)
      .setLabel("Give investigation role")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`security:kick:discord:${memberId}`)
      .setLabel("Kick")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`security:clear:discord:${memberId}`)
      .setLabel("Clear here")
      .setStyle(ButtonStyle.Success)
  );
}

function robloxReviewRow(robloxId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`security:clear:roblox:${robloxId}`)
      .setLabel("Clear here")
      .setStyle(ButtonStyle.Success)
  );
}

async function giveInvestigationRole(member, settings) {
  if (!settings.investigationRoleId) return false;
  const role = await member.guild.roles.fetch(settings.investigationRoleId).catch(() => null);
  if (!role) return false;
  await member.roles.add(role, "Blacklisted member under investigation").catch(() => null);
  return true;
}

async function handleSecurityButton(interaction) {
  const [, action, targetType, targetId] = interaction.customId.split(":");

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)) {
    await interaction.reply({ content: "You need Kick Members permission to use this.", ephemeral: true });
    return;
  }

  if (action === "clear") {
    addWhitelist(interaction.guild.id, {
      discordId: targetType === "discord" ? targetId : null,
      robloxId: targetType === "roblox" ? targetId : null,
      reason: "Cleared from security alert button",
      createdBy: interaction.user.id
    });
    await interaction.reply({ content: "Cleared locally. This account will bypass security actions in this server.", ephemeral: true });
    return;
  }

  if (targetType !== "discord") {
    await interaction.reply({ content: "That action only works for Discord members.", ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "That member is no longer in this server.", ephemeral: true });
    return;
  }

  const settings = getGuildSettings(interaction.guild.id);

  if (action === "role") {
    const ok = await giveInvestigationRole(member, settings);
    await interaction.reply({
      content: ok ? `Investigation role applied to <@${member.id}>.` : "No investigation role is configured.",
      ephemeral: true
    });
    return;
  }

  if (action === "kick") {
    await member.kick("Staff kicked blacklisted member from security prompt");
    await interaction.reply({ content: `Kicked <@${member.id}>.`, ephemeral: true });
  }
}

function defaultPunishment(level) {
  if (level === "high") return "ban";
  if (level === "medium") return "ask";
  return "warn";
}

module.exports = {
  PUNISHMENTS,
  SECURITY_LEVELS,
  handleDiscordMember,
  handleRobloxPlayer,
  handleSecurityButton,
  normalizeId,
  validateIdentity
};
