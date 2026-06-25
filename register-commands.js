const { REST, Routes } = require("discord.js");
const { discordClientId, discordGuildId, discordToken } = require("./config");
const { commands } = require("./commands");

const rest = new REST({ version: "10" }).setToken(discordToken);
const body = commands.map((command) => command.data.toJSON());

async function main() {
  if (discordGuildId) {
    await rest.put(Routes.applicationGuildCommands(discordClientId, discordGuildId), { body });
    console.log(`Registered ${body.length} guild command(s).`);
    return;
  }

  await rest.put(Routes.applicationCommands(discordClientId), { body });
  console.log(`Registered ${body.length} global command(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
