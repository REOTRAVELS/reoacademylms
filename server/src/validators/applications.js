import { z } from 'zod';

export const submitApplicationSchema = z.object({
  body: z.object({
    programOfferingId: z.string().min(1),
  }),
});

export const approveApplicationSchema = z.object({
  body: z.object({
    adminNotes: z.string().trim().max(2000).optional(),
  }),
});

export const rejectApplicationSchema = z.object({
  body: z.object({
    rejectionReason: z.string().trim().min(3).max(2000),
    adminNotes: z.string().trim().max(2000).optional(),
  }),
});
