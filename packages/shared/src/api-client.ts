import type {
  AdminDriverView,
  ApproveDriverRequest,
  AssignCheckRequest,
  DriverApplication,
  DriverConsentsRequest,
  DriverDocumentKind,
  DriverGuarantorsRequest,
  DriverHomeRequest,
  DriverProfileRequest,
  RevealRequest,
  StaffMember,
  UploadRequest,
  UploadTicket,
  VettingCheckView,
  VettingQueueItem,
  VettingResultRequest,
} from './drivers';
import type {
  BookingView,
  CancelBookingRequest,
  CreateBookingRequest,
  DriverLocationRequest,
  DriverOffer,
  ShiftView,
  StartShiftRequest,
} from './matching';
import type { TrackView, TripPhotoRequest, TripPhotoUploadRequest } from './trip';
import type {
  PlaceSuggestion,
  Place,
  QuoteRequest,
  QuoteView,
  Vehicle,
  VehicleRequest,
} from './booking';
import type {
  AuthTokens,
  Me,
  OtpRequest,
  OtpVerify,
  RefreshRequest,
  SignupRequest,
  SignupResult,
  UpdateMeRequest,
  VerifyResult,
} from './auth';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  /** Returns the current access token, if signed in. */
  getAccessToken?: () => string | null | undefined;
}

/** Typed client for the Driva API, shared by the client and driver apps. */
export function createApiClient(options: ApiClientOptions) {
  const doFetch: FetchLike =
    options.fetch ?? ((globalThis as { fetch?: unknown }).fetch as FetchLike);
  const base = options.baseUrl.replace(/\/$/, '');

  async function call<T>(method: string, path: string, body?: unknown, auth = false): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = options.getAccessToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await doFetch(`${base}/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
    if (!res.ok) throw new ApiError(res.status, errorMessage(data));
    return data as T;
  }

  return {
    requestOtp: (body: OtpRequest) =>
      call<{ expiresIn: number }>('POST', '/auth/otp/request', body),
    verifyOtp: (body: OtpVerify) => call<VerifyResult>('POST', '/auth/otp/verify', body),
    signup: (body: SignupRequest) => call<SignupResult>('POST', '/auth/signup', body),
    refresh: (body: RefreshRequest) => call<AuthTokens>('POST', '/auth/refresh', body),
    logout: (body: RefreshRequest) => call<void>('POST', '/auth/logout', body),
    me: () => call<Me>('GET', '/me', undefined, true),
    updateMe: (body: UpdateMeRequest) => call<Me>('PATCH', '/me', body, true),

    cities: () => call<{ id: string; name: string }[]>('GET', '/cities'),

    // Booking.
    placeSearch: (q: string, near?: { lat: number; lng: number }) =>
      call<PlaceSuggestion[]>(
        'GET',
        `/places/search?${new URLSearchParams({ q, ...(near ? { lat: String(near.lat), lng: String(near.lng) } : {}) })}`,
        undefined,
        true,
      ),
    placeDetails: (placeId: string) =>
      call<Place>('GET', `/places/details/${encodeURIComponent(placeId)}`, undefined, true),
    reverseGeocode: (at: { lat: number; lng: number }) =>
      call<Place>('GET', `/places/reverse?lat=${at.lat}&lng=${at.lng}`, undefined, true),
    createQuote: (body: QuoteRequest) => call<QuoteView>('POST', '/quotes', body, true),
    getQuote: (id: string) => call<QuoteView>('GET', `/quotes/${id}`, undefined, true),
    vehicles: () => call<Vehicle[]>('GET', '/vehicles', undefined, true),
    addVehicle: (body: VehicleRequest) => call<Vehicle>('POST', '/vehicles', body, true),
    createBooking: (body: CreateBookingRequest) =>
      call<BookingView>('POST', '/bookings', body, true),
    currentBooking: () =>
      call<{ booking: BookingView | null }>('GET', '/bookings/current', undefined, true),
    getBooking: (id: string) => call<BookingView>('GET', `/bookings/${id}`, undefined, true),
    cancelBooking: (id: string, body: CancelBookingRequest = {}) =>
      call<BookingView>('POST', `/bookings/${id}/cancel`, body, true),

    // Driver app: shifts and requests.
    shift: () => call<ShiftView>('GET', '/drivers/me/shift', undefined, true),
    shiftSelfieUpload: (body: UploadRequest) =>
      call<UploadTicket>('POST', '/drivers/me/shift/selfie', body, true),
    startShift: (body: StartShiftRequest) =>
      call<ShiftView>('POST', '/drivers/me/shift/start', body, true),
    endShift: () => call<ShiftView>('POST', '/drivers/me/shift/end', {}, true),
    sendLocation: (body: DriverLocationRequest) =>
      call<void>('POST', '/drivers/me/location', body, true),
    currentOffer: () =>
      call<{ offer: DriverOffer | null }>('GET', '/drivers/me/offer', undefined, true),
    acceptOffer: (id: string) => call<BookingView>('POST', `/offers/${id}/accept`, {}, true),
    declineOffer: (id: string) => call<void>('POST', `/offers/${id}/decline`, {}, true),

    // The trip.
    arrived: (id: string) => call<BookingView>('POST', `/trips/${id}/arrived`, {}, true),
    checkPin: (id: string, pin: string) =>
      call<BookingView>('POST', `/trips/${id}/pin`, { pin }, true),
    tripPhotoUpload: (id: string, body: TripPhotoUploadRequest) =>
      call<UploadTicket>('POST', `/trips/${id}/photos/upload`, body, true),
    saveTripPhoto: (id: string, body: TripPhotoRequest) =>
      call<BookingView>('PUT', `/trips/${id}/photos`, body, true),
    startTrip: (id: string) => call<BookingView>('POST', `/trips/${id}/start`, {}, true),
    endTrip: (id: string) => call<BookingView>('POST', `/trips/${id}/end`, {}, true),
    shareTrip: (id: string) =>
      call<{ url: string; expiresAt: string | null }>('POST', `/trips/${id}/share`, {}, true),
    track: (token: string) => call<TrackView>('GET', `/track/${encodeURIComponent(token)}`),

    // Driver app: the signed in driver's own application.
    driverApplication: () => call<DriverApplication>('GET', '/drivers/me', undefined, true),
    saveDriverProfile: (body: DriverProfileRequest) =>
      call<DriverApplication>('PUT', '/drivers/me/profile', body, true),
    saveDriverHome: (body: DriverHomeRequest) =>
      call<DriverApplication>('PUT', '/drivers/me/home', body, true),
    saveGuarantors: (body: DriverGuarantorsRequest) =>
      call<DriverApplication>('PUT', '/drivers/me/guarantors', body, true),
    documentUpload: (kind: DriverDocumentKind, body: UploadRequest) =>
      call<UploadTicket>('POST', `/drivers/me/documents/${kind}/upload`, body, true),
    saveDocument: (kind: DriverDocumentKind, key: string) =>
      call<DriverApplication>('PUT', `/drivers/me/documents/${kind}`, { key }, true),
    saveConsents: (body: DriverConsentsRequest) =>
      call<DriverApplication>('PUT', '/drivers/me/consents', body, true),
    submitApplication: () => call<DriverApplication>('POST', '/drivers/me/submit', {}, true),

    // Admin dashboard.
    vettingQueue: () => call<VettingQueueItem[]>('GET', '/admin/vetting/queue', undefined, true),
    staff: () => call<StaffMember[]>('GET', '/admin/staff', undefined, true),
    adminDriver: (id: string) =>
      call<AdminDriverView>('GET', `/admin/drivers/${id}`, undefined, true),
    reveal: (id: string, body: RevealRequest) =>
      call<{ value: string }>('POST', `/admin/drivers/${id}/reveal`, body, true),
    approveDriver: (id: string, body: ApproveDriverRequest) =>
      call<AdminDriverView>('POST', `/admin/drivers/${id}/approve`, body, true),
    assignCheck: (checkId: string, body: AssignCheckRequest) =>
      call<VettingCheckView>('POST', `/admin/vetting/${checkId}/assign`, body, true),
    evidenceUpload: (checkId: string, body: UploadRequest) =>
      call<UploadTicket>('POST', `/admin/vetting/${checkId}/evidence`, body, true),
    recordResult: (checkId: string, body: VettingResultRequest) =>
      call<AdminDriverView>('POST', `/admin/vetting/${checkId}/result`, body, true),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

function errorMessage(data: unknown): string {
  const message = (data as { message?: unknown } | undefined)?.message;
  if (Array.isArray(message)) return message.join('. ');
  if (typeof message === 'string') return message;
  return 'Something went wrong. Please try again.';
}
