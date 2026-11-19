import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';

export const createS3Client = (endpoint) => new S3Client({
  region: env.livekitRecordingS3Region,
  endpoint: endpoint || undefined,
  forcePathStyle: env.livekitRecordingS3ForcePathStyle,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: env.livekitRecordingS3AccessKey,
    secretAccessKey: env.livekitRecordingS3Secret,
  },
});

export const createObjectStorageService = ({
  bucket,
  uploadClient,
  playbackClient = uploadClient,
  signUrl = getSignedUrl,
}) => ({
  createUploadIntent: async ({ key, contentType, ownerId, sizeBytes }) => {
    const headers = {
      'Content-Type': contentType,
      'x-amz-meta-owner-id': ownerId,
      'x-amz-meta-expected-size': String(sizeBytes),
    };
    const uploadUrl = await signUrl(
      uploadClient,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        Metadata: {
          'owner-id': ownerId,
          'expected-size': String(sizeBytes),
        },
      }),
      { expiresIn: 300 },
    );
    return { uploadUrl, headers };
  },

  verifyUpload: async ({ key, contentType, ownerId, sizeBytes }) => {
    const head = await uploadClient.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (
      head.Metadata?.['owner-id'] !== ownerId
      || head.Metadata?.['expected-size'] !== String(sizeBytes)
      || head.ContentLength !== sizeBytes
      || head.ContentType !== contentType
    ) {
      return null;
    }

    const object = await uploadClient.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: 'bytes=0-15',
    }));
    const chunks = [];
    for await (const chunk of object.Body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).subarray(0, 16);
  },

  createDownloadUrl: async ({ key, fileName, contentType, expiresIn = 300 }) => {
    const safeName = fileName.replace(/[\r\n"\\]/g, '_');
    return signUrl(
      playbackClient,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: `inline; filename="${safeName}"`,
      }),
      { expiresIn },
    );
  },

  putObject: async ({ key, body, contentType, contentLength = body.length, metadata }) => uploadClient.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentLength: contentLength,
    ContentType: contentType,
    Metadata: metadata,
  })),

  getObjectBuffer: async (key) => {
    const object = await uploadClient.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks = [];
    for await (const chunk of object.Body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  },

  createMultipartUpload: async ({ key, contentType, metadata }) => uploadClient.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    Metadata: metadata,
  })),

  uploadPart: async ({ key, uploadId, partNumber, body, contentLength = body.length }) => (
    uploadClient.send(new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
      ContentLength: contentLength,
    }))
  ),

  completeMultipartUpload: async ({ key, uploadId, parts }) => uploadClient.send(new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts },
  })),

  abortMultipartUpload: async ({ key, uploadId }) => uploadClient.send(new AbortMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
  })),

  deleteObject: async (key) => uploadClient.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  })),
});

let storageService;

export const isObjectStorageEnabled = () => env.fileStorageProvider === 's3';

export const getObjectStorage = () => {
  if (!isObjectStorageEnabled()) {
    throw new Error('S3 object storage is not enabled');
  }
  if (!storageService) {
    const endpoint = env.livekitRecordingS3Endpoint || undefined;
    const playbackEndpoint = env.livekitRecordingS3PlaybackEndpoint || endpoint;
    storageService = createObjectStorageService({
      bucket: env.livekitRecordingS3Bucket,
      uploadClient: createS3Client(endpoint),
      playbackClient: createS3Client(playbackEndpoint),
    });
  }
  return storageService;
};
