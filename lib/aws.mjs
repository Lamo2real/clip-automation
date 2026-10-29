import { createReadStream, createWriteStream, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } from "@aws-sdk/client-sqs";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "./env.mjs";

// Credentials come from your AWS CLI login (aws configure), not from .env.
const s3 = new S3Client({});
const sqs = new SQSClient({});
const bucket = () => requireEnv("S3_BUCKET", "the BucketName output of the AWS stack");
const queue = () => requireEnv("JOBS_QUEUE_URL", "the JobsQueueUrl output of the AWS stack");

export async function downloadObject(key, dest) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  await pipeline(Body, createWriteStream(dest));
  return dest;
}

export async function uploadObject(file, key, contentType = "video/mp4") {
  await s3.send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: createReadStream(file),
    ContentLength: statSync(file).size,
    ContentType: contentType,
  }));
  return key;
}

// A temporary public link, so Instagram and Facebook can fetch the video from the private bucket.
export function presign(key, seconds = 3600) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: seconds });
}

export async function receive() {
  const { Messages = [] } = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: queue(),
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 20,
  }));
  return Messages;
}

export const ack = (msg) => sqs.send(new DeleteMessageCommand({ QueueUrl: queue(), ReceiptHandle: msg.ReceiptHandle }));

// Makes a failed message reappear soon instead of waiting out the full visibility timeout.
export const retryLater = (msg, seconds = 60) =>
  sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: queue(), ReceiptHandle: msg.ReceiptHandle, VisibilityTimeout: seconds }));
