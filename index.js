const { Client, Collection, Events, GatewayIntentBits, Partials } = require("discord.js");
const { discordToken } = require("./config");
const { commands } = require("./commands");
const { ErlcApiError } = require("./erlcClient");
const { startErlcScanner } = require("./scanner");
const { handleDiscordMember, handleSecurityButton } = require("./security");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember]
});

client.commands = new Collection();

for (const command of commands) {
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  startErlcScanner(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith("security:")) {
    await handleSecurityButton(interaction).catch(console.error);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);

    const message =
      error instanceof ErlcApiError
        ? `ER:LC API error (${error.status}): ${error.message}`
        : "Something went wrong while running that command.";

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  await handleDiscordMember(member).catch(console.error);
});

client.login(discordToken);
