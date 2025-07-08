const { Client, GatewayIntentBits } = require("discord.js");
const {
  AutoScalingClient,
  SetDesiredCapacityCommand,
} = require("@aws-sdk/client-auto-scaling");

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ASG_NAME = process.env.ASG_NAME;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = "ap-northeast-2";

const autoScalingClient = new AutoScalingClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const commands = [
  {
    name: "start",
    description: "Starts the Minecraft server",
  },
];

const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Auto Scaling Group Name: ${ASG_NAME}`);

  if (!CLIENT_ID || !GUILD_ID) {
    console.error(
      "Missing environment variables for command deployment: CLIENT_ID and GUILD_ID are required."
    );
    return;
  }

  try {
    console.log(
      `Started refreshing ${commands.length} application (/) commands.`
    );

    // The put method is used to fully refresh all commands in the guild with the current set
    const data = await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log(
      `Successfully reloaded ${data.length} application (/) commands.`
    );
  } catch (error) {
    console.error("Error deploying commands:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  if (commandName === "start") {
    await interaction.deferReply();
    if (!ASG_NAME || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      await interaction.editReply(
        "Bot is not configured with AWS credentials or ASG name."
      );
      return;
    }

    try {
      const command = new SetDesiredCapacityCommand({
        AutoScalingGroupName: ASG_NAME,
        DesiredCapacity: 1, // Set desired capacity to 1 to start the server
        HonorCooldown: false,
      });
      await autoScalingClient.send(command);
      await interaction.editReply(
        `Server start request sent for ${ASG_NAME}. Server should be starting soon.`
      );
    } catch (error) {
      console.error("Error starting server:", error);
      await interaction.editReply(
        `Failed to send server start request: ${error.message}`
      );
    }
  }
});

client.login(DISCORD_BOT_TOKEN);