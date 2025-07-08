import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
// 단일 AZ 사용을 위해 명시적으로 지정합니다. 한국 리전으로 변경.
const availabilityZone = "ap-northeast-2a";
const awsRegion = "ap-northeast-2";

// 1. Networking (VPC, Subnet, IGW, Route Table)
const vpc = new aws.ec2.Vpc("minecraft-vpc", {
  cidrBlock: "10.0.0.0/16",
  enableDnsHostnames: true,
  enableDnsSupport: true,
  tags: { Name: "minecraft-vpc" },
});

const igw = new aws.ec2.InternetGateway("minecraft-igw", {
  vpcId: vpc.id,
  tags: { Name: "minecraft-igw" },
});

const subnet = new aws.ec2.Subnet("minecraft-subnet", {
  vpcId: vpc.id,
  cidrBlock: "10.0.1.0/24",
  availabilityZone: availabilityZone,
  mapPublicIpOnLaunch: true,
  tags: { Name: "minecraft-subnet" },
});

const routeTable = new aws.ec2.RouteTable("minecraft-rt", {
  vpcId: vpc.id,
  routes: [
    {
      cidrBlock: "0.0.0.0/0",
      gatewayId: igw.id,
    },
  ],
  tags: { Name: "minecraft-rt" },
});

new aws.ec2.RouteTableAssociation("minecraft-rta", {
  subnetId: subnet.id,
  routeTableId: routeTable.id,
});

// 2. Security Group
const securityGroup = new aws.ec2.SecurityGroup("minecraft-sg", {
  vpcId: vpc.id,
  description: "Allow Minecraft and SSH traffic",
  ingress: [
    {
      protocol: "tcp",
      fromPort: 25565,
      toPort: 25565,
      cidrBlocks: ["0.0.0.0/0"],
    },
    { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"] },
  ],
  egress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
  ],
  tags: { Name: "minecraft-sg" },
});

// 3. EBS Volume
const ebsVolume = new aws.ebs.Volume("minecraft-ebs", {
  availabilityZone: availabilityZone,
  size: 20, // 모드 파일들을 고려하여 20GB로 증설
  type: "gp3",
  tags: { Name: "minecraft-ebs" },
});

// 4. IAM Role for EC2
const ec2Role = new aws.iam.Role("minecraft-ec2-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "ec2.amazonaws.com",
  }),
});

const ec2Policy = new aws.iam.Policy("minecraft-ec2-policy", {
  policy: pulumi.interpolate`{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "ec2:AttachVolume",
                    "ec2:DescribeVolumes"
                ],
                "Resource": "*"
            },
            {
                "Effect": "Allow",
                "Action": "ec2:DescribeInstances",
                "Resource": "*"
            },
            {
                "Effect": "Allow",
                "Action": [
                    "autoscaling:DescribeAutoScalingGroups",
                    "autoscaling:DescribeAutoScalingInstances"
                ],
                "Resource": "*"
            },
            {
                "Effect": "Allow",
                "Action": "autoscaling:SetDesiredCapacity",
                "Resource": "*",
                "Condition": {
                    "StringEquals": {
                        "autoscaling:ResourceTag/Name": "minecraft-server-instance"
                    }
                }
            },
            {
                "Effect": "Allow",
                "Action": "ssm:GetParameter",
                "Resource": "arn:aws:ssm:${awsRegion}:*:parameter/minecraft/*"
            }
        ]
    }`,
});

new aws.iam.RolePolicyAttachment("minecraft-ec2-role-attachment", {
  role: ec2Role.name,
  policyArn: ec2Policy.arn,
});

const instanceProfile = new aws.iam.InstanceProfile(
  "minecraft-instance-profile",
  {
    role: ec2Role.name,
  }
);

// 5. Launch Template
const ami = aws.ssm
  .getParameter(
    {
      name: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64",
    },
    { async: true }
  )
  .then((ami) => ami.value);

const launchTemplate = new aws.ec2.LaunchTemplate("minecraft-launch-template", {
  namePrefix: "minecraft-",
  imageId: ami,
  instanceType: "r8g.large",
  vpcSecurityGroupIds: [securityGroup.id],
  iamInstanceProfile: {
    arn: instanceProfile.arn,
  },
  keyName: "robin_maki@planet.moe",
  metadataOptions: {
    httpTokens: "optional", // Allows IMDSv1
    httpEndpoint: "enabled",
  },
  userData: pulumi.interpolate`#!/bin/bash
        exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1
        echo "--- Starting User Data Script ---"

        EBS_VOLUME_ID="${ebsVolume.id}"
        MOUNT_POINT="/srv/minecraft"
        DEVICE_NAME="/dev/sdf"
        INSTANCE_ID=""
        while [ -z "$INSTANCE_ID" ]; do
            INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
            if [ -z "$INSTANCE_ID" ]; then
                echo "Waiting for instance ID..."
                sleep 5
            fi
        done
        AWS_REGION="${awsRegion}"
        ASG_NAME=$(aws autoscaling describe-auto-scaling-instances --instance-ids $INSTANCE_ID --query 'AutoScalingInstances[0].AutoScalingGroupName' --output text --region $AWS_REGION)

        # Cloudflare variables (REPLACE WITH YOUR ACTUAL VALUES OR USE PULUMI SECRETS)
        # Example: CLOUDFLARE_API_TOKEN=$(pulumi config get --secret cloudflareApiToken)
        # Example: CLOUDFLARE_ZONE_ID=$(pulumi config get cloudflareZoneId)
        # Example: CLOUDFLARE_RECORD_NAME=$(pulumi config get cloudflareRecordName)
        CLOUDFLARE_AUTH_EMAIL=$(aws ssm get-parameter --name "/minecraft/cloudflare/auth-email" --query Parameter.Value --output text --region $AWS_REGION)
        CLOUDFLARE_API_KEY=$(aws ssm get-parameter --name "/minecraft/cloudflare/api-token" --with-decryption --query Parameter.Value --output text --region $AWS_REGION)
        CLOUDFLARE_ZONE_ID=$(aws ssm get-parameter --name "/minecraft/cloudflare/zone-id" --query Parameter.Value --output text --region $AWS_REGION)
        CLOUDFLARE_RECORD_NAME=$(aws ssm get-parameter --name "/minecraft/cloudflare/record-name" --query Parameter.Value --output text --region $AWS_REGION)

        # Install AWS CLI (if not already present) and jq for JSON parsing
        yum install -y awscli jq screen java-17-amazon-corretto-headless

        # Wait for EBS Volume to become available before attaching
        echo "Waiting for EBS volume $EBS_VOLUME_ID to become available..."
        while true; do
            VOLUME_STATE=$(aws ec2 describe-volumes --volume-ids $EBS_VOLUME_ID --query 'Volumes[0].State' --output text --region $AWS_REGION 2>/dev/null)
            if [ "$VOLUME_STATE" == "available" ]; then
                echo "Volume is available."
                break
            fi
            echo "Volume state is '$VOLUME_STATE'. Waiting 15 seconds..."
            sleep 15
        done

        # Attach and mount EBS volume
        aws ec2 attach-volume --volume-id $EBS_VOLUME_ID --instance-id $INSTANCE_ID --device $DEVICE_NAME --region $AWS_REGION

        while [ ! -e $DEVICE_NAME ]; do sleep 5; done

        if ! file -s $DEVICE_NAME | grep -q "filesystem"; then
            mkfs -t xfs $DEVICE_NAME
        fi

        mkdir -p $MOUNT_POINT
        mount $DEVICE_NAME $MOUNT_POINT

        if ! mountpoint -q $MOUNT_POINT; then exit 1; fi

        cd $MOUNT_POINT

        # Cloudflare DNS Update
        PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
        echo "Public IP: $PUBLIC_IP"

        if [ -n "$PUBLIC_IP" ] && [ -n "$CLOUDFLARE_AUTH_EMAIL" ] && [ -n "$CLOUDFLARE_API_KEY" ] && [ -n "$CLOUDFLARE_ZONE_ID" ] && [ -n "$CLOUDFLARE_RECORD_NAME" ]; then
            echo "Updating Cloudflare DNS record..."
            RECORD_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records?type=A&name=$CLOUDFLARE_RECORD_NAME" \
                -H "X-Auth-Email: $CLOUDFLARE_AUTH_EMAIL" \
                -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
                -H "Content-Type: application/json" | jq -r '.result[0].id')
            echo "RECORD_ID: $RECORD_ID"

            if [ -n "$RECORD_ID" ]; then
                JSON_PAYLOAD=$(jq -n \
                  --arg name "$CLOUDFLARE_RECORD_NAME" \
                  --arg content "$PUBLIC_IP" \
                  '{type: "A", name: $name, content: $content, ttl: 60, proxied: false}')
                curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records/$RECORD_ID" \
                    -H "X-Auth-Email: $CLOUDFLARE_AUTH_EMAIL" \
                    -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
                    -H "Content-Type: application/json" \
                    --data "$JSON_PAYLOAD"
                echo "JSON_PAYLOAD: $JSON_PAYLOAD"
                echo "Cloudflare DNS record updated."
            else
                echo "Cloudflare DNS record not found, creating new one..."
                JSON_PAYLOAD=$(jq -n \
                  --arg name "$CLOUDFLARE_RECORD_NAME" \
                  --arg content "$PUBLIC_IP" \
                  '{type: "A", name: $name, content: $content, ttl: 60, proxied: false}')
                curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
                    -H "X-Auth-Email: $CLOUDFLARE_AUTH_EMAIL" \
                    -H "X-Auth-Key: $CLOUDFLARE_API_KEY" \
                    -H "Content-Type: application/json" \
                    --data "$JSON_PAYLOAD"
                echo "Cloudflare DNS record created."
            fi
        else
            echo "Cloudflare DNS update skipped. Missing IP or Cloudflare credentials."
        fi

        # Start Minecraft server in screen
        screen -S minecraft -d -m ./run.sh

        # Auto Shutdown Script
        (
            sleep 300 # Delay initial check by 5 minutes
            ZERO_PLAYER_COUNT=0
            while true; do
                sleep 60 # Check every minute
                
                # 플레이어 수를 확인하기 위해 hardcopy 사용
                HARDCOPY_FILE="/tmp/minecraft_hardcopy.log"
                # 이전 로그 파일 삭제
                rm -f $HARDCOPY_FILE
                # list 명령어를 서버에 전송
                screen -S minecraft -X stuff "list\n"
                sleep 2 # 명령어 실행 및 출력 대기
                # 화면 출력을 파일에 저장
                screen -S minecraft -X hardcopy $HARDCOPY_FILE
                sleep 1 # 파일 저장 대기

                PLAYER_COUNT=""
                if [ -f "$HARDCOPY_FILE" ]; then
                    # 로그 파일에서 마지막 플레이어 수 관련 줄을 찾음
                    PLAYER_COUNT_LINE=$(grep "There are" "$HARDCOPY_FILE" | tail -1)
                    if [ -n "$PLAYER_COUNT_LINE" ]; then
                        # 해당 줄에서 숫자만 추출
                        PLAYER_COUNT=$(echo "$PLAYER_COUNT_LINE" | grep -oP 'There are \K\d+')
                    fi
                fi
                
                if [ -z "$PLAYER_COUNT" ]; then
                    PLAYER_COUNT=0
                fi

                echo "Current players: $PLAYER_COUNT"

                if [ "$PLAYER_COUNT" -eq 0 ]; then
                    ZERO_PLAYER_COUNT=$((ZERO_PLAYER_COUNT + 1))
                    echo "Zero players for $ZERO_PLAYER_COUNT minute(s)."
                    if [ "$ZERO_PLAYER_COUNT" -ge 5 ]; then
                        echo "No players for 5 minutes. Sending stop command to Minecraft server."
                        screen -S minecraft -X stuff "stop\n"
                        
                        echo "Waiting for Minecraft server to shut down gracefully..."
                        # screen 세션이 종료될 때까지 대기 (서버 프로세스가 완전히 끝났음을 의미)
                        while screen -ls | grep -q "\\.minecraft\\s"; do
                            echo "Server is still running, waiting 10 seconds..."
                            sleep 10
                        done
                        
                        echo "Minecraft server has shut down."
                        echo "Setting ASG desired capacity to 0."
                        aws autoscaling set-desired-capacity --auto-scaling-group-name $ASG_NAME --desired-capacity 0 --region $AWS_REGION
                        break
                    fi
                else
                    ZERO_PLAYER_COUNT=0
                fi
            done
        ) & # Run in background

        echo "--- User Data Script Finished ---"
    `.apply((userData) => Buffer.from(userData).toString("base64")),

  tags: {
    Name: "minecraft-server-template",
  },
});

// 6. Auto Scaling Group
const autoScalingGroup = new aws.autoscaling.Group("minecraft-asg", {
  vpcZoneIdentifiers: [subnet.id],
  desiredCapacity: 0,
  minSize: 0,
  maxSize: 1,
  launchTemplate: {
    id: launchTemplate.id,
    version: "$Latest",
  },
  tags: [
    {
      key: "Name",
      value: "minecraft-server-instance",
      propagateAtLaunch: true,
    },
  ],
});

// 7. IAM User for Discord Bot
const discordBotUser = new aws.iam.User("minecraft-discord-bot-user", {
  name: "minecraft-discord-bot-user",
});

const discordBotPolicy = new aws.iam.Policy("minecraft-discord-bot-policy", {
  policy: pulumi.interpolate`{
      "Version": "2012-10-17",
      "Statement": [
          {
              "Effect": "Allow",
              "Action": [
                  "autoscaling:DescribeAutoScalingGroups",
                  "autoscaling:DescribeAutoScalingInstances"
              ],
              "Resource": "*"
          },
          {
              "Effect": "Allow",
              "Action": "autoscaling:SetDesiredCapacity",
              "Resource": "*",
              "Condition": {
                  "StringEquals": {
                      "autoscaling:ResourceTag/Name": "minecraft-server-instance"
                  }
              }
          }
      ]
  }`,
});

new aws.iam.UserPolicyAttachment("minecraft-discord-bot-policy-attachment", {
  user: discordBotUser.name,
  policyArn: discordBotPolicy.arn,
});

// Create a single AccessKey for the Discord bot user
const discordBotAccessKey = new aws.iam.AccessKey(
  "minecraft-discord-bot-access-key",
  {
    user: discordBotUser.name,
    status: "Active",
  }
);

// --- Outputs ---
export const vpcId = vpc.id;
export const subnetId = subnet.id;
export const securityGroupId = securityGroup.id;
export const ebsVolumeId = ebsVolume.id;
export const launchTemplateId = launchTemplate.id;
export const autoScalingGroupName = autoScalingGroup.name;
export const discordBotAccessKeyId = discordBotAccessKey.id;
export const discordBotSecretAccessKey = discordBotAccessKey.secret;
