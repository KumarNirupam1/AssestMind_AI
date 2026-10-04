/**
 * lib/s3.ts — S3 client singleton for raw document storage.
 *
 * Bucket: assetmind-docs-919484652794 (ap-south-1)
 * Region: ap-south-1
 *
 * Uses standard AWS credential chain (env vars in dev, IAM role on Vercel).
 * Call `getS3()` to get the client — singleton, lazy-initialised.
 */
import { S3Client } from "@aws-sdk/client-s3";

const REGION = process.env.AWS_REGION ?? "ap-south-1";
export const S3_DOCUMENT_BUCKET =
  process.env.S3_DOCUMENT_BUCKET ?? "assetmind-docs-919484652794";

let _s3: S3Client | undefined;

export function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({ region: REGION });
  }
  return _s3;
}
