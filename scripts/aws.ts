// AWS clients of the upload scripts, from the AWS SDK for JavaScript.
//
// The clients take the region from AWS_DEFAULT_REGION and the credentials from
// the default provider chain of the SDK: the standard AWS environment
// variables, which aws-actions/configure-aws-credentials sets in CI and
// `aws-vault exec` sets locally. Each client keeps its HTTPS connections open
// and runs up to `connections` requests at once, so the scripts send many
// requests in parallel over a few reused connections.
//
// The key store API signs with SigV4A; the import below registers the
// JavaScript SigV4A signer of the SDK, which needs no native module.

import "@aws-sdk/signature-v4a";

import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { CloudFrontKeyValueStoreClient } from "@aws-sdk/client-cloudfront-keyvaluestore";
import { S3Client, S3ServiceException } from "@aws-sdk/client-s3";

/** Return an S3 client for the region of AWS_DEFAULT_REGION, with up to `connections` requests at once. */
export function s3Client(connections: number): S3Client {
  return new S3Client({ region: requireEnv("AWS_DEFAULT_REGION"), requestHandler: { httpsAgent: { keepAlive: true, maxSockets: connections } } });
}

/** Return a CloudFront client. */
export function cloudFrontClient(): CloudFrontClient {
  return new CloudFrontClient({ region: requireEnv("AWS_DEFAULT_REGION") });
}

/** Return a client of the CloudFront key value store API. */
export function keyStoreClient(): CloudFrontKeyValueStoreClient {
  return new CloudFrontKeyValueStoreClient({ region: requireEnv("AWS_DEFAULT_REGION") });
}

/** Clear every path from the cache of a CloudFront distribution. */
export async function invalidateAll(client: CloudFrontClient, distribution: string): Promise<void> {
  await client.send(
    new CreateInvalidationCommand({
      DistributionId: distribution,
      InvalidationBatch: { CallerReference: `deploy-${crypto.randomUUID()}`, Paths: { Quantity: 1, Items: ["/*"] } },
    }),
  );
}

/** Tell whether an S3 request failed with 404 Not Found. */
export function isNotFound(error: unknown): boolean {
  return error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404;
}

/**
 * Value of the CopySource parameter of CopyObject for an object: the bucket
 * and the key, with each path segment of the key URL-encoded, as S3 requires.
 */
export function copySource(bucket: string, key: string): string {
  return `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Return the value of a required environment variable. */
export function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Set ${name}: see .env.example`);
  }
  return value;
}
