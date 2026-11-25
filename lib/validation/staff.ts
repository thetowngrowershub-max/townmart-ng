import { z } from "zod";

const flags = z.record(z.string().max(30), z.boolean());

export const inviteStaffSchema = z.object({
  email: z.email("Enter their email address").trim().toLowerCase().max(254),
  permissions: flags.refine((f) => Object.values(f).some(Boolean), "Give them at least one area to work on"),
});

export const staffPermissionsSchema = z.object({ staffId: z.uuid(), permissions: flags });
export const staffIdSchema = z.object({ staffId: z.uuid() });
export const invitationIdSchema = z.object({ invitationId: z.uuid() });
export const acceptInvitationSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/) });
