const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require("discord.js");
const { ownerGuildId, ownerUserIds } = require("./config");
const {
  addAppeal,
  addBlacklist,
  addReport,
  addWhitelist,
  findAppeal,
  findBlacklist,
  findBlacklistByCaseId,
  getGuildSettings,
  listBlacklist,
  removeBlacklist,
  removeWhitelist,
  updateAppeal,
  updateBlacklist,
  updateGuildSettings
} = require("./database");
const { fetchServerInfo, runServerCommand } = require("./erlcClient");
const { PUNISHMENTS, SECURITY_LEVELS, normalizeId, validateIdentity } = require("./security");

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Check that the bot is online."),
    async execute(interaction) {
      await interaction.reply({ content: `Online. Discord latency: ${interaction.client.ws.ping}ms`, ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Configure this server's security bot settings.")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("set")
          .setDescription("Set channels, ER:LC key, and server staff role.")
          .addChannelOption((option) =>
            option
              .setName("alert-channel")
              .setDescription("Where security alerts should be sent.")
              .addChannelTypes(ChannelType.GuildText)
          )
          .addChannelOption((option) =>
            option
              .setName("report-channel")
              .setDescription("Where reports should be logged.")
              .addChannelTypes(ChannelType.GuildText)
          )
          .addChannelOption((option) =>
            option
              .setName("appeal-channel")
              .setDescription("Where appeals should be logged.")
              .addChannelTypes(ChannelType.GuildText)
          )
          .addRoleOption((option) =>
            option.setName("investigation-role").setDescription("Role used for medium-security review.")
          )
          .addRoleOption((option) =>
            option.setName("server-staff-role").setDescription("Role allowed to manage this server's bot settings.")
          )
          .addStringOption((option) =>
            option
              .setName("erlc-api-key")
              .setDescription("Private ER:LC server API key for this Discord server.")
              .setMaxLength(200)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("show")
          .setDescription("Show current settings for this server.")
      ),
    async execute(interaction) {
      if (!canManageServerBot(interaction)) {
        await interaction.reply({ content: "You need Manage Server, server owner, or the configured bot staff role.", ephemeral: true });
        return;
      }

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "show") {
        const settings = getGuildSettings(interaction.guildId);
        await interaction.reply({ content: formatSettings(settings), ephemeral: true });
        return;
      }

      const patch = {};
      const alertChannel = interaction.options.getChannel("alert-channel");
      const reportChannel = interaction.options.getChannel("report-channel");
      const appealChannel = interaction.options.getChannel("appeal-channel");
      const investigationRole = interaction.options.getRole("investigation-role");
      const serverStaffRole = interaction.options.getRole("server-staff-role");
      const erlcApiKey = interaction.options.getString("erlc-api-key");

      if (alertChannel) patch.alertChannelId = alertChannel.id;
      if (reportChannel) patch.reportChannelId = reportChannel.id;
      if (appealChannel) patch.appealChannelId = appealChannel.id;
      if (investigationRole) patch.investigationRoleId = investigationRole.id;
      if (serverStaffRole) patch.serverStaffRoleId = serverStaffRole.id;
      if (erlcApiKey) patch.erlcServerKey = erlcApiKey;

      const settings = updateGuildSettings(interaction.guildId, patch);
      await auditLog(interaction, "Server Settings Updated", [
        `Guild: ${interaction.guild.name} (${interaction.guildId})`,
        `Updated by: ${interaction.user.tag} (${interaction.user.id})`
      ]);
      await interaction.reply({ content: `Settings saved.\n${formatSettings(settings)}`, ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName("channelset")
      .setDescription("Set bot log and alert channels.")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("audit-log")
          .setDescription("Set the main server audit log channel.")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("Audit log channel.")
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("security-alert")
          .setDescription("Set this server's channel for blacklist join alerts and staff buttons.")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("Security alert channel.")
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("global-staff-role")
          .setDescription("Set the role allowed to manage blacklist and appeal decisions.")
          .addRoleOption((option) =>
            option.setName("role").setDescription("Trusted staff role.").setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("show").setDescription("Show channel settings.")
      ),
    async execute(interaction) {
      const subcommand = interaction.options.getSubcommand();
      const settings = getGuildSettings(interaction.guildId);

      if (subcommand === "show") {
        await interaction.reply({
          content: [
            `Security alerts: ${settings.alertChannelId ? `<#${settings.alertChannelId}>` : "not set"}`,
            `Audit log: ${settings.auditLogChannelId ? `<#${settings.auditLogChannelId}>` : "not set"}`,
            `Global staff role: ${settings.globalStaffRoleId ? `<@&${settings.globalStaffRoleId}>` : "not set"}`
          ].join("\n"),
          ephemeral: true
        });
        return;
      }

      if (subcommand === "security-alert") {
        if (!canManageServerBot(interaction)) {
          await interaction.reply({ content: "You need Manage Server, server owner, or the configured bot staff role.", ephemeral: true });
          return;
        }

        const channel = interaction.options.getChannel("channel", true);
        updateGuildSettings(interaction.guildId, { alertChannelId: channel.id });
        await interaction.reply({ content: `Security alert channel set to <#${channel.id}>.`, ephemeral: true });
        await auditLog(interaction, "Security Alert Channel Set", [
          `Guild: ${interaction.guild.name} (${interaction.guildId})`,
          `Channel: <#${channel.id}>`,
          `Set by: ${interaction.user.tag} (${interaction.user.id})`
        ]);
        return;
      }

      if (!isMainGuild(interaction)) {
        await interaction.reply({ content: "That channel setting only works in the main support server.", ephemeral: true });
        return;
      }

      if (!isBotOwner(interaction)) {
        await interaction.reply({ content: "Only a configured bot owner can use this setup command.", ephemeral: true });
        return;
      }

      if (subcommand === "audit-log") {
        const channel = interaction.options.getChannel("channel", true);
        updateGuildSettings(interaction.guildId, { auditLogChannelId: channel.id });
        await interaction.reply({ content: `Audit log channel set to <#${channel.id}>.`, ephemeral: true });
        await auditLog(interaction, "Audit Log Channel Set", [`Channel: <#${channel.id}>`]);
        return;
      }

      const role = interaction.options.getRole("role", true);
      updateGuildSettings(interaction.guildId, { globalStaffRoleId: role.id });
      await interaction.reply({ content: `Global staff role set to <@&${role.id}>.`, ephemeral: true });
      await auditLog(interaction, "Global Staff Role Set", [`Role: <@&${role.id}>`]);
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName("security")
      .setDescription("Configure punishments for blacklist security levels.")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("set")
          .setDescription("Set punishment for a security level.")
          .addStringOption((option) =>
            option
              .setName("level")
              .setDescription("Security level to change.")
              .setRequired(true)
              .addChoices(...SECURITY_LEVELS.map((level) => ({ name: level, value: level })))
          )
          .addStringOption((option) =>
            option
              .setName("punishment")
              .setDescription("What this server should do for that level.")
              .setRequired(true)
              .addChoices(...PUNISHMENTS.map((punishment) => ({ name: punishment, value: punishment })))
          )
      ),
    async execute(interaction) {
      if (!canManageServerBot(interaction)) {
        await interaction.reply({ content: "You need Manage Server, server owner, or the configured bot staff role.", ephemeral: true });
        return;
      }

      const level = interaction.options.getString("level", true);
      const punishment = interaction.options.getString("punishment", true);
      const settings = updateGuildSettings(interaction.guildId, {
        punishments: { [level]: punishment }
      });

      await interaction.reply({
        content: `${level} security now uses \`${settings.punishments[level]}\` in this server.`,
        ephemeral: true
      });
      await auditLog(interaction, "Security Punishment Updated", [
        `Guild: ${interaction.guild.name} (${interaction.guildId})`,
        `Level: ${level}`,
        `Punishment: ${punishment}`
      ]);
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName("report")
      .setDescription("Report a Roblox or Discord account with proof.")
      .addStringOption((option) =>
        option.setName("reason").setDescription("Why are you reporting them?").setRequired(true).setMaxLength(1000)
      )
      .addStringOption((option) =>
        option.setName("discord-id").setDescription("Discord user ID if known.").setMaxLength(30)
      )
      .addStringOption((option) =>
        option.setName("roblox-id").setDescription("Roblox user ID if known.").setMaxLength(30)
      )
      .addAttachmentOption((option) =>
        option.setName("proof-file").setDescription("Screenshot/video proof.")
      )
      .addStringOption((option) =>
        option.setName("proof-link").setDescription("Proof link if the file is hosted elsewhere.").setMaxLength(500)
      ),
    async execute(interaction) {
      if (!isMainGuild(interaction)) {
        await interaction.reply({ content: "Reports only work in the main support server.", ephemeral: true });
        return;
      }

      const discordId = normalizeId(interaction.options.getString("discord-id"));
      const robloxId = normalizeId(interaction.options.getString("roblox-id"));
      const identityError = validateIdentity(discordId, robloxId);
      if (identityError) return interaction.reply({ content: identityError, ephemeral: true });

      const proofFile = interaction.options.getAttachment("proof-file");
      const proofLink = normalizeId(interaction.options.getString("proof-link"));
      if (!proofFile && !proofLink) {
        return interaction.reply({ content: "Proof is required. Add a file or proof link.", ephemeral: true });
      }

      const report = addReport({
        guildId: interaction.guildId,
        reporterId: interaction.user.id,
        discordId,
        robloxId,
        reason: interaction.options.getString("reason", true),
        proof: proofFile?.url || proofLink
      });

      await sendLog(interaction, "reportChannelId", reportEmbed("New Report", report, interaction.user.id));
      await interaction.reply({ content: `Report submitted. Case ID: \`${report.id}\``, ephemeral: true });
      await auditLog(interaction, "Report Submitted", [
        `Case ID: ${report.id}`,
        `Reporter: ${interaction.user.tag} (${interaction.user.id})`,
        `Discord ID: ${discordId || "not provided"}`,
        `Roblox ID: ${robloxId || "not provided"}`
      ]);
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName("appeal")
      .setDescription("Appeal a blacklist.")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("submit")
          .setDescription("Submit a blacklist appeal.")
          .addStringOption((option) =>
            option.setName("reason").setDescription("Why should the blacklist be removed?").setRequired(true).setMaxLength(1000)
          )
          .addStringOption((option) =>
            option.setName("discord-id").setDescription("Your Discord ID if different.").setMaxLength(30)
          )
          .addStringOption((option) =>
            option.setName("roblox-id").setDescription("Your Roblox user ID if relevant.").setMaxLength(30)
          )
          .addAttachmentOption((option) =>
            option.setName("proof-file").setDescription("Appeal proof.")
          )
          .addStringOption((option) =>
            option.setName("proof-link").setDescription("Appeal proof link.").setMaxLength(500)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("approve")
          .setDescription("Approve an appeal and remove matching blacklist entries.")
          .addStringOption((option) =>
            option.setName("appeal-id").setDescription("Appeal ID to approve.").setRequired(true)
          )
          .addStringOption((option) =>
            option.setName("reason").setDescription("Decision note.").setMaxLength(500)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("deny")
          .setDescription("Deny an appeal.")
          .addStringOption((option) =>
            option.setName("appeal-id").setDescription("Appeal ID to deny.").setRequired(true)
          )
          .addStringOption((option) =>
            option.setName("reason").setDescription("Decision note.").setRequired(true).setMaxLength(500)
          )
      ),
    async execute(interaction) {
      if (!isMainGuild(interaction)) {
        await interaction.reply({ content: "Appeals only work in the main support server.", ephemeral: true });
        return;
      }

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "approve" || subcommand === "deny") {
        if (!canUseMainStaffCommands(interaction)) {
          await interaction.reply({ content: "Only the configured main-server staff role can decide appeals.", ephemeral: true });
          return;
        }

        const appealId = interaction.options.getString("appeal-id", true);
        const appeal = findAppeal(appealId);
        if (!appeal) {
          await interaction.reply({ content: "No appeal found with that ID.", ephemeral: true });
          return;
        }

        const reason = normalizeId(interaction.options.getString("reason")) || "No decision note provided";
        const status = subcommand === "approve" ? "approved" : "denied";
        updateAppeal(appealId, {
          status,
          decidedBy: interaction.user.id,
          decidedAt: new Date().toISOString(),
          decisionReason: reason
        });

        if (subcommand === "approve") {
          removeBlacklist({ discordId: appeal.discordId, robloxId: appeal.robloxId });
        }

        await interaction.reply({ content: `Appeal \`${appealId}\` ${status}.`, ephemeral: true });
        await auditLog(interaction, `Appeal ${status}`, [
          `Appeal ID: ${appealId}`,
          `Discord ID: ${appeal.discordId || "not provided"}`,
          `Roblox ID: ${appeal.robloxId || "not provided"}`,
          `Decision by: ${interaction.user.tag} (${interaction.user.id})`,
          `Reason: ${reason}`
        ]);
        return;
      }

      const discordId = normalizeId(interaction.options.getString("discord-id")) || interaction.user.id;
      const robloxId = normalizeId(interaction.options.getString("roblox-id"));
      const proofFile = interaction.options.getAttachment("proof-file");
      const proofLink = normalizeId(interaction.options.getString("proof-link"));
      const appeal = addAppeal({
        guildId: interaction.guildId,
        appellantId: interaction.user.id,
        discordId,
        robloxId,
        reason: interaction.options.getString("reason", true),
        proof: proofFile?.url || proofLink || null
      });

      await sendLog(interaction, "appealChannelId", reportEmbed("New Appeal", appeal, interaction.user.id));
      await interaction.reply({ content: `Appeal submitted. Appeal ID: \`${appeal.id}\``, ephemeral: true });
      await auditLog(interaction, "Appeal Submitted", [
        `Appeal ID: ${appeal.id}`,
        `User: ${interaction.user.tag} (${interaction.user.id})`,
        `Discord ID: ${discordId || "not provided"}`,
        `Roblox ID: ${robloxId || "not provided"}`
      ]);
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName("blacklist")
      .setDescription("Manage the shared blacklist from the main support server.")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("add")
          .setDescription("Add a Discord or Roblox account to the security blacklist.")
          .addStringOption((option) =>
            option
              .setName("level")
              .setDescription("Security level.")
              .setRequired(true)
              .addChoices(...SECURITY_LEVELS.map((level) => ({ name: level, value: level })))
          )
          .addStringOption((option) =>
            option.setName("reason").setDescription("Reason for blacklist.").setRequired(true).setMaxLength(1000)
          )
          .addStringOption((option) =>
            option.setName("discord-id").setDescription("Discord user ID.").setMaxLength(30)
          )
          .addStringOption((option) =>
            option.setName("roblox-id").setDescription("Roblox user ID.").setMaxLength(30)
          )
          .addStringOption((option) =>
            option.setName("proof").setDescription("Proof link.").setMaxLength(500)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("remove")
          .setDescription("Remove an account from the blacklist.")
          .addStringOption((option) =>
            option.setName("discord-id").setDescription("Discord user ID.").setMaxLength(30)
          )
          .addStringOption((option) =>
            option.setName("roblox-id").setDescription("Roblox user ID.").setMaxLength(30)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("check")
          .setDescription("Check whether an account is blacklisted.")
          .addStringOption((option) =>
            option.setName("discord-id").setDescription("Discord user ID.").setMaxLength(30)
          )
          .addStringOption((option) =>
            option.setName("roblox-id").setDescription("Roblox user ID.").setMaxLength(30)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("list").setDescription("List recent unique blacklist entries.")
      ),
    async execute(interaction) {
      if (ownerGuildId && interaction.guildId !== ownerGuildId) {
        await interaction.reply({ content: "Blacklist commands can only be used in the main support server.", ephemeral: true });
        return;
      }

      if (!canUseMainStaffCommands(interaction)) {
        await interaction.reply({ content: "Only the configured main-server staff role can use blacklist commands.", ephemeral: true });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      const discordId = normalizeId(interaction.options.getString("discord-id"));
      const robloxId = normalizeId(interaction.options.getString("roblox-id"));

      if (subcommand === "list") {
        const entries = listBlacklist().slice(-10).reverse();
        await interaction.reply({
          content: entries.length
            ? entries.map((entry) => `Case \`${entry.id}\` | \`${entry.securityLevel}\` | D:${entry.discordId || "-"} R:${entry.robloxId || "-"} - ${entry.reason}`).join("\n")
            : "No blacklist entries yet.",
          ephemeral: true
        });
        return;
      }

      const identityError = validateIdentity(discordId, robloxId);
      if (identityError) return interaction.reply({ content: identityError, ephemeral: true });

      if (subcommand === "add") {
        const entry = addBlacklist({
          discordId,
          robloxId,
          reason: interaction.options.getString("reason", true),
          securityLevel: interaction.options.getString("level", true),
          proof: normalizeId(interaction.options.getString("proof")),
          createdBy: interaction.user.id
        });
        await interaction.reply({ content: `Blacklisted. Entry ID: \`${entry.id}\``, ephemeral: true });
        await auditLog(interaction, "Blacklist Added", [
          `Entry ID: ${entry.id}`,
          `Discord ID: ${discordId || "not provided"}`,
          `Roblox ID: ${robloxId || "not provided"}`,
          `Level: ${entry.securityLevel}`,
          `Reason: ${entry.reason}`,
          `Added by: ${interaction.user.tag} (${interaction.user.id})`
        ]);
        return;
      }

      if (subcommand === "remove") {
        const removed = removeBlacklist({ discordId, robloxId });
        await interaction.reply({ content: removed ? "Blacklist entry removed." : "No matching blacklist entry found.", ephemeral: true });
        if (removed) {
          await auditLog(interaction, "Blacklist Removed", [
            `Discord ID: ${discordId || "not provided"}`,
            `Roblox ID: ${robloxId || "not provided"}`,
            `Removed by: ${interaction.user.tag} (${interaction.user.id})`
          ]);
        }
        return;
      }

      const entry = findBlacklist({ discordId, robloxId });
      await interaction.reply({
        content: entry
          ? formatBlacklistEntry(entry)
          : "No matching blacklist entry found.",
        ephemeral: true
      });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName("editblacklist")
      .setDescription("Edit a blacklist case by case ID from the main support server.")
      .addStringOption((option) =>
        option.setName("case-id").setDescription("Blacklist case ID.").setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("level")
          .setDescription("New security level.")
          .addChoices(...SECURITY_LEVELS.map((level) => ({ name: level, value: level })))
      )
      .addStringOption((option) =>
        option.setName("reason").setDescription("New reason.").setMaxLength(1000)
      )
      .addStringOption((option) =>
        option.setName("discord-id").setDescription("Add or replace Discord ID.").setMaxLength(30)
      )
      .addStringOption((option) =>
        option.setName("roblox-id").setDescription("Add or replace Roblox ID.").setMaxLength(30)
      )
      .addStringOption((option) =>
        option.setName("proof").setDescription("New proof link.").setMaxLength(500)
      ),
    async execute(interaction) {
      if (!canUseMainStaffCommands(interaction)) {
        await interaction.reply({ content: "Only the configured main-server staff role can edit blacklist cases.", ephemeral: true });
        return;
      }

      const caseId = interaction.options.getString("case-id", true);
      const existing = findBlacklistByCaseId(caseId);
      if (!existing) {
        await interaction.reply({ content: "No blacklist case found with that ID.", ephemeral: true });
        return;
      }

      const updated = updateBlacklist(caseId, {
        discordId: normalizeId(interaction.options.getString("discord-id")) || existing.discordId,
        robloxId: normalizeId(interaction.options.getString("roblox-id")) || existing.robloxId,
        reason: normalizeId(interaction.options.getString("reason")) || existing.reason,
        securityLevel: normalizeId(interaction.options.getString("level")) || existing.securityLevel,
        proof: normalizeId(interaction.options.getString("proof")) || existing.proof,
        updatedBy: interaction.user.id
      });

      await interaction.reply({ content: `Updated blacklist case.\n${formatBlacklistEntry(updated)}`, ephemeral: true });
      await auditLog(interaction, "Blacklist Edited", [
        `Case ID: ${caseId}`,
        `Discord ID: ${updated.discordId || "not provided"}`,
        `Roblox ID: ${updated.robloxId || "not provided"}`,
        `Level: ${updated.securityLevel}`,
        `Edited by: ${interaction.user.tag} (${interaction.user.id})`
      ]);
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName("lookup")
      .setDescription("Publicly check whether a Discord ID, Roblox ID, or case ID is blacklisted.")
      .addStringOption((option) =>
        option.setName("case-id").setDescription("Blacklist case ID.")
      )
      .addStringOption((option) =>
        option.setName("discord-id").setDescription("Discord user ID.").setMaxLength(30)
      )
      .addStringOption((option) =>
        option.setName("roblox-id").setDescription("Roblox user ID.").setMaxLength(30)
      ),
    async execute(interaction) {
      const caseId = normalizeId(interaction.options.getString("case-id"));
      const discordId = normalizeId(interaction.options.getString("discord-id"));
      const robloxId = normalizeId(interaction.options.getString("roblox-id"));

      if (!caseId && !discordId && !robloxId) {
        await interaction.reply({ content: "Provide a case ID, Discord ID, or Roblox ID to lookup.", ephemeral: true });
        return;
      }

      const entry = caseId ? findBlacklistByCaseId(caseId) : findBlacklist({ discordId, robloxId });
      await interaction.reply({
        content: entry ? formatBlacklistEntry(entry) : "No matching blacklist entry found.",
        ephemeral: false
      });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName("whitelist")
      .setDescription("Let an account bypass security actions in this server.")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("add")
          .setDescription("Whitelist an account.")
          .addStringOption((option) =>
            option.setName("discord-id").setDescription("Discord user ID.").setMaxLength(30)
          )
          .addStringOption((option) =>
            option.setName("roblox-id").setDescription("Roblox user ID.").setMaxLength(30)
          )
          .addStringOption((option) =>
            option.setName("reason").setDescription("Reason for whitelisting.").setMaxLength(500)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("remove")
          .setDescription("Remove a whitelist bypass.")
          .addStringOption((option) =>
            option.setName("discord-id").setDescription("Discord user ID.").setMaxLength(30)
          )
          .addStringOption((option) =>
            option.setName("roblox-id").setDescription("Roblox user ID.").setMaxLength(30)
          )
      ),
    async execute(interaction) {
      if (!canManageServerBot(interaction)) {
        await interaction.reply({ content: "You need Manage Server, server owner, or the configured bot staff role.", ephemeral: true });
        return;
      }

      const discordId = normalizeId(interaction.options.getString("discord-id"));
      const robloxId = normalizeId(interaction.options.getString("roblox-id"));
      const identityError = validateIdentity(discordId, robloxId);
      if (identityError) return interaction.reply({ content: identityError, ephemeral: true });

      if (interaction.options.getSubcommand() === "add") {
        addWhitelist(interaction.guildId, {
          discordId,
          robloxId,
          reason: normalizeId(interaction.options.getString("reason")),
          createdBy: interaction.user.id
        });
        await interaction.reply({ content: "Whitelist bypass added.", ephemeral: true });
        await auditLog(interaction, "Whitelist Added", [
          `Guild: ${interaction.guild.name} (${interaction.guildId})`,
          `Discord ID: ${discordId || "not provided"}`,
          `Roblox ID: ${robloxId || "not provided"}`,
          `Added by: ${interaction.user.tag} (${interaction.user.id})`
        ]);
        return;
      }

      const removed = removeWhitelist(interaction.guildId, { discordId, robloxId });
      await interaction.reply({ content: removed ? "Whitelist bypass removed." : "No matching whitelist bypass found.", ephemeral: true });
      if (removed) {
        await auditLog(interaction, "Whitelist Removed", [
          `Guild: ${interaction.guild.name} (${interaction.guildId})`,
          `Discord ID: ${discordId || "not provided"}`,
          `Roblox ID: ${robloxId || "not provided"}`,
          `Removed by: ${interaction.user.tag} (${interaction.user.id})`
        ]);
      }
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName("erlc-status")
      .setDescription("Show live ER:LC private server status."),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const settings = getGuildSettings(interaction.guildId);
      const server = await fetchServerInfo(settings.erlcServerKey, { players: true, queue: true, vehicles: true });
      await interaction.editReply(formatServerInfo(server).join("\n"));
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName("erlc-command")
      .setDescription("Run an ER:LC server command.")
      .addStringOption((option) =>
        option.setName("command").setDescription("Example: :h Hello").setRequired(true).setMaxLength(500)
      ),
    async execute(interaction) {
      if (!canManageServerBot(interaction)) {
        await interaction.reply({ content: "You need Manage Server, server owner, or the configured bot staff role.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const settings = getGuildSettings(interaction.guildId);
      const command = interaction.options.getString("command", true);
      await runServerCommand(settings.erlcServerKey, command);
      await interaction.editReply(`Sent to ER:LC: \`${command}\``);
      await auditLog(interaction, "ER:LC Command Sent", [
        `Guild: ${interaction.guild.name} (${interaction.guildId})`,
        `Command: ${command}`,
        `Sent by: ${interaction.user.tag} (${interaction.user.id})`
      ]);
    }
  }
];

function formatSettings(settings) {
  return [
    `Alert channel: ${settings.alertChannelId ? `<#${settings.alertChannelId}>` : "not set"}`,
    `Report channel: ${settings.reportChannelId ? `<#${settings.reportChannelId}>` : "not set"}`,
    `Appeal channel: ${settings.appealChannelId ? `<#${settings.appealChannelId}>` : "not set"}`,
    `Audit log channel: ${settings.auditLogChannelId ? `<#${settings.auditLogChannelId}>` : "not set"}`,
    `Investigation role: ${settings.investigationRoleId ? `<@&${settings.investigationRoleId}>` : "not set"}`,
    `Server staff role: ${settings.serverStaffRoleId ? `<@&${settings.serverStaffRoleId}>` : "not set"}`,
    `Global staff role: ${settings.globalStaffRoleId ? `<@&${settings.globalStaffRoleId}>` : "not set"}`,
    `ER:LC API key: ${settings.erlcServerKey ? "set" : "not set"}`,
    `Punishments: low=${settings.punishments.low}, medium=${settings.punishments.medium}, high=${settings.punishments.high}`
  ].join("\n");
}

function reportEmbed(title, report, reporterId) {
  return new EmbedBuilder()
    .setColor(0x2f80ed)
    .setTitle(title)
    .addFields(
      { name: "Case ID", value: report.id, inline: true },
      { name: "Submitted By", value: `<@${reporterId}>`, inline: true },
      { name: "Discord ID", value: report.discordId || "Not provided", inline: true },
      { name: "Roblox ID", value: report.robloxId || "Not provided", inline: true },
      { name: "Reason", value: report.reason },
      { name: "Proof", value: report.proof || "Not provided" }
    )
    .setTimestamp();
}

function formatBlacklistEntry(entry) {
  return [
    `Case ID: \`${entry.id}\``,
    `Security level: \`${entry.securityLevel}\``,
    `Discord IDs: ${formatIds(entry.discordIds, entry.discordId)}`,
    `Roblox IDs: ${formatIds(entry.robloxIds, entry.robloxId)}`,
    `Reason: ${entry.reason || "No reason provided"}`,
    `Proof: ${entry.proof || "Not provided"}`
  ].join("\n");
}

function formatIds(ids = [], fallback) {
  const values = [...new Set([...(ids || []), fallback].filter(Boolean))];
  return values.length ? values.join(", ") : "Not provided";
}

async function sendLog(interaction, settingName, embed) {
  const settings = getGuildSettings(interaction.guildId);
  const channelId = settings[settingName] || settings.alertChannelId;
  if (!channelId) return;

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ embeds: [embed] });
}

function isMainGuild(interaction) {
  return Boolean(ownerGuildId && interaction.guildId === ownerGuildId);
}

function isBotOwner(interaction) {
  if (ownerUserIds.length === 0) {
    return interaction.guild?.ownerId === interaction.user.id;
  }

  return ownerUserIds.includes(interaction.user.id);
}

function canUseMainStaffCommands(interaction) {
  if (!isMainGuild(interaction)) return false;
  if (isBotOwner(interaction)) return true;

  const settings = getGuildSettings(interaction.guildId);
  if (!settings.globalStaffRoleId) return false;

  return interaction.member?.roles?.cache?.has(settings.globalStaffRoleId) || false;
}

function canManageServerBot(interaction) {
  if (interaction.guild?.ownerId === interaction.user.id) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;

  const settings = getGuildSettings(interaction.guildId);
  if (!settings.serverStaffRoleId) return false;

  return interaction.member?.roles?.cache?.has(settings.serverStaffRoleId) || false;
}

async function auditLog(interaction, title, lines) {
  if (!ownerGuildId) return;

  const settings = getGuildSettings(ownerGuildId);
  if (!settings.auditLogChannelId) return;

  const guild = await interaction.client.guilds.fetch(ownerGuildId).catch(() => null);
  if (!guild) return;

  const channel = await guild.channels.fetch(settings.auditLogChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(lines.join("\n"))
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);
}

function formatServerInfo(server) {
  const name = server?.Name || server?.name || "ER:LC Server";
  const owner = server?.Owner || server?.owner;
  const players = server?.CurrentPlayers ?? server?.currentPlayers ?? server?.players?.length;
  const maxPlayers = server?.MaxPlayers ?? server?.maxPlayers;
  const queue = Array.isArray(server?.queue) ? server.queue.length : server?.Queue;
  const lines = [`**${name}**`];

  if (owner) lines.push(`Owner: ${owner}`);
  if (players !== undefined && maxPlayers !== undefined) lines.push(`Players: ${players}/${maxPlayers}`);
  if (players !== undefined && maxPlayers === undefined) lines.push(`Players: ${players}`);
  if (queue !== undefined) lines.push(`Queue: ${queue}`);
  if (lines.length === 1) lines.push("Connected, but the API returned an unknown shape.");

  return lines;
}

module.exports = {
  commands
};
