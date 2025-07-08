import {
  AutoScalingClient,
  SetDesiredCapacityCommand,
} from "@aws-sdk/client-auto-scaling";

const autoScalingClient = new AutoScalingClient({
  region: process.env.AWS_REGION,
});

export const handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  const asgName = process.env.ASG_NAME;
  const desiredCapacity = 1;

  if (!asgName) {
    console.error("ASG_NAME environment variable is not set.");
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "ASG_NAME environment variable is required.",
      }),
    };
  }

  try {
    const command = new SetDesiredCapacityCommand({
      AutoScalingGroupName: asgName,
      DesiredCapacity: desiredCapacity,
      HonorCooldown: false,
    });
    await autoScalingClient.send(command);
    console.log(
      `Successfully set desired capacity of ${asgName} to ${desiredCapacity}`
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successfully set desired capacity of ${asgName} to ${desiredCapacity}`,
      }),
    };
  } catch (error) {
    console.error("Error setting desired capacity:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Failed to set desired capacity",
        error: error.message,
      }),
    };
  }
};
