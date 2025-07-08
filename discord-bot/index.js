import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  Collection,
} from "discord.js";
import { commands } from "./command.js";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  try {
    console.log(
      `Started refreshing ${commands.length} application (/) commands.`
    );

    for (const command of commands) {
      client.commands.set(command.data.name, command);
    }

    console.log(
      `Successfully reloaded ${commands.length} application (/) commands.`
    );
  } catch (error) {
    console.error("Error deploying commands:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "There was an error while executing this command!",
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: "There was an error while executing this command!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
