import { z } from 'zod';
import { phoneSchema } from './auth';
import { addMonthsUtc } from './pricing';

// ---------- vetting ----------

/** Same order as the vetting_step enum and the prototype's progress list. */
export const VETTING_STEPS = [
  'documents',
  'home_visit',
  'guarantor_visit_1',
  'guarantor_visit_2',
  'criminal_record',
  'final_review',
] as const;
export type VettingStep = (typeof VETTING_STEPS)[number];

export const VETTING_STEP_LABELS: Record<VettingStep, string> = {
  documents: 'Documents, NIN and licence',
  home_visit: 'Home visit',
  guarantor_visit_1: 'Guarantor 1 visit',
  guarantor_visit_2: 'Guarantor 2 visit',
  criminal_record: 'Criminal record check',
  final_review: 'Final review',
};

/** Steps done in person. They need GPS stamped photo evidence to pass. */
export const FIELD_VISIT_STEPS: readonly VettingStep[] = [
  'home_visit',
  'guarantor_visit_1',
  'guarantor_visit_2',
];

export const CHECK_STATUSES = ['pending', 'in_progress', 'passed', 'failed'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const DRIVER_STATUSES = [
  'applied',
  'in_vetting',
  'approved',
  'rejected',
  'suspended',
] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

/** Full vetting must be redone every 12 months. */
export const VETTING_VALID_MONTHS = 12;

/** True while the driver's last full vetting is less than 12 months old. */
export function isVettingCurrent(lastFullVettingAt: Date | null, now: Date): boolean {
  if (!lastFullVettingAt) return false;
  return now.getTime() < addMonthsUtc(lastFullVettingAt, VETTING_VALID_MONTHS).getTime();
}

/** A driver can go online only when approved and their vetting is current. */
export function canGoOnline(
  driver: { status: DriverStatus; lastFullVettingAt: Date | null },
  now: Date,
): boolean {
  return driver.status === 'approved' && isVettingCurrent(driver.lastFullVettingAt, now);
}

// ---------- registration ----------

export const YEARS_DRIVING = ['Under 3 years', '4 to 7 years', '8 years or more'] as const;

export const DRIVER_DOCUMENT_KINDS = ['licence', 'nin', 'passport_photo', 'selfie'] as const;
export type DriverDocumentKind = (typeof DRIVER_DOCUMENT_KINDS)[number];

export const DRIVER_DOCUMENT_LABELS: Record<DriverDocumentKind, string> = {
  licence: 'Driving licence',
  nin: 'NIN slip or card',
  passport_photo: 'Passport photograph',
  selfie: 'Selfie',
};

export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const text = (label: string, max = 200) =>
  z.string().trim().min(2, `Enter ${label}`).max(max, `${label} is too long`);

export const driverProfileSchema = z
  .object({
    cityId: z.string().uuid('Choose your city'),
    nin: z
      .string()
      .transform((v) => v.replace(/\s/g, ''))
      .pipe(z.string().regex(/^\d{11}$/, 'Your NIN is 11 digits')),
    licenceNumber: z
      .string()
      .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9]{6,20}$/, 'Enter your driving licence number as printed')),
    yearsDriving: z.enum(YEARS_DRIVING, {
      errorMap: () => ({ message: 'Choose how long you have driven' }),
    }),
  })
  .strict();
export type DriverProfileRequest = z.input<typeof driverProfileSchema>;
export type ParsedDriverProfile = z.output<typeof driverProfileSchema>;

export const driverHomeSchema = z.object({ homeAddress: text('your home address', 300) }).strict();
export type DriverHomeRequest = z.input<typeof driverHomeSchema>;

const guarantorSchema = z
  .object({
    fullName: text('the guarantor’s full name', 100),
    phone: phoneSchema,
    relationship: text('the relationship and occupation', 200),
    address: text('the guarantor’s home address', 300),
  })
  .strict();

export const driverGuarantorsSchema = z
  .object({
    guarantors: z.tuple([guarantorSchema, guarantorSchema]),
    /** The driver confirms both meet the rules. VeriQuest confirms in person. */
    confirmRules: z.literal(true, {
      errorMap: () => ({ message: 'Confirm that both guarantors meet the rules' }),
    }),
  })
  .strict()
  .refine((v) => v.guarantors[0].phone !== v.guarantors[1].phone, {
    message: 'Use two different guarantors',
    path: ['guarantors'],
  });
export type DriverGuarantorsRequest = z.input<typeof driverGuarantorsSchema>;
export type ParsedDriverGuarantors = z.output<typeof driverGuarantorsSchema>;

export const driverConsentsSchema = z
  .object({
    homeVisit: z.literal(true, { errorMap: () => ({ message: 'Agree to the home visit' }) }),
    guarantorVisits: z.literal(true, {
      errorMap: () => ({ message: 'Agree to your guarantors being visited' }),
    }),
    idAndCriminalChecks: z.literal(true, {
      errorMap: () => ({ message: 'Agree to the ID and criminal record checks' }),
    }),
  })
  .strict();
export type DriverConsentsRequest = z.input<typeof driverConsentsSchema>;

export const uploadRequestSchema = z
  .object({
    contentType: z.enum(UPLOAD_CONTENT_TYPES, {
      errorMap: () => ({ message: 'Upload a JPEG or PNG photo' }),
    }),
  })
  .strict();
export type UploadRequest = z.input<typeof uploadRequestSchema>;

export const driverDocumentSchema = z.object({ key: z.string().min(1).max(300) }).strict();

export interface UploadTicket {
  key: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresIn: number;
}

/** What the driver app needs to resume registration or show vetting progress. */
export interface DriverApplication {
  status: DriverStatus | 'not_started';
  cityId: string | null;
  hasProfile: boolean;
  yearsDriving: string | null;
  homeAddress: string | null;
  guarantorCount: number;
  documents: DriverDocumentKind[];
  consentsGiven: boolean;
  submittedAt: string | null;
  approvedAt: string | null;
  canGoOnline: boolean;
  vetting: { step: VettingStep; status: CheckStatus }[];
}

/** What is still missing before the application can be submitted. Empty means ready. */
export function missingForSubmission(app: DriverApplication): string[] {
  const missing: string[] = [];
  if (!app.hasProfile) missing.push('Your NIN, licence and driving experience');
  for (const kind of DRIVER_DOCUMENT_KINDS) {
    if (!app.documents.includes(kind)) missing.push(DRIVER_DOCUMENT_LABELS[kind]);
  }
  if (!app.homeAddress) missing.push('Your home address');
  if (app.guarantorCount < 2) missing.push('Two guarantors');
  if (!app.consentsGiven) missing.push('Your consent to the checks');
  return missing;
}

// ---------- admin ----------

const point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const vettingResultSchema = z
  .object({
    status: z.enum(['passed', 'failed']),
    note: z.string().trim().max(2000).optional(),
    evidenceKeys: z.array(z.string().min(1).max(300)).max(20).optional(),
    visitLocation: point.optional(),
  })
  .strict()
  .refine((v) => v.status !== 'failed' || (v.note && v.note.length >= 5), {
    message: 'Write the reason the check failed',
    path: ['note'],
  });
export type VettingResultRequest = z.input<typeof vettingResultSchema>;
export type ParsedVettingResult = z.output<typeof vettingResultSchema>;

export const approveDriverSchema = z
  .object({
    note: z.string().trim().max(2000).optional(),
    /** Founding drivers are vetted free. Only admins can set this. */
    vettingFeeWaived: z.boolean().optional(),
  })
  .strict();
export type ApproveDriverRequest = z.input<typeof approveDriverSchema>;

export const assignCheckSchema = z
  .object({
    officerId: z.string().uuid(),
    scheduledFor: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type AssignCheckRequest = z.input<typeof assignCheckSchema>;

export const revealSchema = z.object({ field: z.enum(['nin', 'licenceNumber']) }).strict();
export type RevealRequest = z.input<typeof revealSchema>;

export interface VettingQueueItem {
  driverId: string;
  fullName: string;
  city: string | null;
  submittedAt: string | null;
  passed: number;
  total: number;
  nextStep: VettingStep | null;
  nextStepStatus: CheckStatus | null;
  officerName: string | null;
  scheduledFor: string | null;
}

export interface VettingCheckView {
  id: string;
  step: VettingStep;
  status: CheckStatus;
  round: number;
  officerId: string | null;
  officerName: string | null;
  scheduledFor: string | null;
  completedAt: string | null;
  resultNote: string | null;
  evidence: { key: string; url: string }[];
  visitLocation: { lat: number; lng: number } | null;
}

export interface AdminDriverView {
  id: string;
  fullName: string;
  phone: string;
  status: DriverStatus;
  city: string | null;
  yearsDriving: string | null;
  ninMasked: string | null;
  licenceMasked: string | null;
  homeAddress: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  lastFullVettingAt: string | null;
  vettingFeeWaived: boolean;
  guarantors: {
    slot: number;
    fullName: string;
    phone: string;
    relationship: string;
    address: string;
  }[];
  documents: { kind: DriverDocumentKind; url: string; uploadedAt: string }[];
  consents: { kind: string; acceptedAt: string }[];
  checks: VettingCheckView[];
}

export interface StaffMember {
  id: string;
  fullName: string;
  role: 'admin' | 'vetting_officer';
}
