import { SlashCommandBuilder } from "discord.js";
import {
  AutoScalingClient,
  SetDesiredCapacityCommand,
} from "@aws-sdk/client-auto-scaling";

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

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName("start")
      .setDescription("서버를 시작함"),

    async execute(interaction) {
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
    },
  },
];
