import { z } from 'zod';
import { normalizeNigerianPhone } from './phone';

/** Length of the SMS login code. */
export const OTP_LENGTH = 6;

/** Which mobile app the request comes from. It decides the role of a new account. */
export const AUTH_APPS = ['client', 'driver'] as const;
export type AuthApp = (typeof AUTH_APPS)[number];

export const USER_ROLES = ['client', 'driver', 'admin', 'vetting_officer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const phone = normalizeNigerianPhone(value);
    if (!phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a Nigerian mobile number' });
      return z.NEVER;
    }
    return phone;
  });

const nameSchema = z.string().trim().min(2, 'Enter your full name').max(100);

export const otpRequestSchema = z.object({ phone: phoneSchema }).strict();
export type OtpRequest = z.input<typeof otpRequestSchema>;

export const otpVerifySchema = z
  .object({
    phone: phoneSchema,
    code: z
      .string()
      .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH} digit code`),
    app: z.enum(AUTH_APPS),
  })
  .strict();
export type OtpVerify = z.input<typeof otpVerifySchema>;

export const signupSchema = z
  .object({
    signupToken: z.string().min(1),
    fullName: nameSchema,
    // Nigeria Data Protection Act: we record that the person agreed before creating the account.
    consent: z.literal(true, {
      errorMap: () => ({ message: 'You need to agree to the terms and privacy notice' }),
    }),
    emergencyContactName: nameSchema.optional(),
    emergencyContactPhone: phoneSchema.optional(),
  })
  .strict()
  .refine(
    (v) => (v.emergencyContactName === undefined) === (v.emergencyContactPhone === undefined),
    {
      message: 'Give both a name and a phone number for your emergency contact, or neither',
      path: ['emergencyContactPhone'],
    },
  );
export type SignupRequest = z.input<typeof signupSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(1) }).strict();
export type RefreshRequest = z.input<typeof refreshSchema>;

export const updateMeSchema = z
  .object({
    fullName: nameSchema,
    email: z.string().trim().email('Enter a valid email').nullable(),
    emergencyContactName: nameSchema.nullable(),
    emergencyContactPhone: phoneSchema.nullable(),
  })
  .partial()
  .strict();
export type UpdateMeRequest = z.input<typeof updateMeSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface Me {
  id: string;
  role: UserRole;
  fullName: string;
  phone: string;
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  createdAt: string;
}

export type VerifyResult =
  | ({ status: 'signed_in'; user: Me } & AuthTokens)
  | { status: 'signup_required'; signupToken: string };

export type SignupResult = { user: Me } & AuthTokens;

/** Request bodies after validation, as the API sees them. */
export type ParsedOtpRequest = z.output<typeof otpRequestSchema>;
export type ParsedOtpVerify = z.output<typeof otpVerifySchema>;
export type ParsedSignup = z.output<typeof signupSchema>;
export type ParsedRefresh = z.output<typeof refreshSchema>;
export type ParsedUpdateMe = z.output<typeof updateMeSchema>;
