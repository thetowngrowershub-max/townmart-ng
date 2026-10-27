import { z } from "zod";
import { nigerianPhone, otpCode } from "./common";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address" }).max(254));

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters");

/** Only same-site relative paths, so `?next=` can't be used as an open redirect. */
export const safeNextPath = z
  .string()
  .optional()
  .transform((v) => (v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : undefined));

export const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: "Please accept the Terms of Use and Privacy Policy" }),
  marketingEmail: z.boolean().default(false),
  turnstileToken: z.string().optional(),
});
export type SignUpInput = z.input<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(128),
  next: safeNextPath,
});
export type SignInInput = z.input<typeof signInSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  turnstileToken: z.string().optional(),
});
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    token: z.string().min(20).max(200),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match",
  });
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({
  email: emailSchema,
  token: z.string().min(20).max(200),
});

export const phoneOnlySchema = z.object({ phone: nigerianPhone });
export const phoneCodeSchema = z.object({ phone: nigerianPhone, code: otpCode, next: safeNextPath });
export type PhoneCodeInput = z.input<typeof phoneCodeSchema>;
