import path from 'path';

export const resourceTypes = new Map([
  ['.pdf', ['application/pdf']],
  ['.png', ['image/png']],
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.gif', ['image/gif']],
  ['.webp', ['image/webp']],
  ['.doc', ['application/msword']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.ppt', ['application/vnd.ms-powerpoint']],
  ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
  ['.xls', ['application/vnd.ms-excel']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.csv', ['text/csv', 'application/vnd.ms-excel']],
  ['.txt', ['text/plain']],
  ['.mp4', ['video/mp4']],
  ['.webm', ['video/webm']],
]);

export const avatarTypes = new Map([
  ['.png', ['image/png']],
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.webp', ['image/webp']],
]);

export const hasAllowedUploadType = (allowedTypes, originalName, mimeType) => (
  allowedTypes.get(path.extname(originalName).toLowerCase())?.includes(mimeType) === true
);

export const resourceFileMatchesType = (header, originalName, mimeType) => {
  const extension = path.extname(originalName).toLowerCase();
  if (mimeType === 'application/pdf') return header.toString('ascii', 0, 5) === '%PDF-';
  if (mimeType === 'image/png') return header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (mimeType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(header.toString('ascii', 0, 6));
  if (mimeType === 'image/webp') return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';
  if (mimeType === 'video/mp4') return header.toString('ascii', 4, 8) === 'ftyp';
  if (mimeType === 'video/webm') return header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (['.doc', '.ppt', '.xls'].includes(extension)) {
    return header.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (['.docx', '.pptx', '.xlsx'].includes(extension)) {
    return header[0] === 0x50 && header[1] === 0x4b;
  }
  if (['text/plain', 'text/csv', 'application/vnd.ms-excel'].includes(mimeType)) {
    return !header.includes(0);
  }
  return false;
};

export const avatarFileMatchesType = (header, mimeType) => (
  (mimeType === 'image/png' && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
  || (mimeType === 'image/jpeg' && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff)
  || (
    mimeType === 'image/webp'
    && header.toString('ascii', 0, 4) === 'RIFF'
    && header.toString('ascii', 8, 12) === 'WEBP'
  )
);
