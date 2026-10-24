import { Injectable, Logger } from '@nestjs/common';
import { SOCKET_EVENTS } from '@driva/shared';
import type { Server } from 'socket.io';

export type Note =
  | { to: string; event: typeof SOCKET_EVENTS.booking; bookingId: string }
  | { to: string; event: typeof SOCKET_EVENTS.offer; offerId: string }
  | {
      to: string;
      event: typeof SOCKET_EVENTS.location;
      bookingId: string;
      lat: number;
      lng: number;
      at: string;
    };

/**
 * Sends real time events to a user's own room. Callers send after their database transaction
 * commits, so an app that fetches on the event sees the new state.
 *
 * One API server for now. More than one needs the Socket.IO Redis adapter.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  send(notes: Note[]): void {
    if (!this.server) return;
    for (const { to, event, ...payload } of notes) {
      this.server.to(`user:${to}`).emit(event, payload);
    }
  }

  /** The two people on a booking: its client and its driver. */
  bookingChanged(bookingId: string, people: (string | null | undefined)[]): Note[] {
    return people
      .filter((p): p is string => !!p)
      .map((to) => ({ to, event: SOCKET_EVENTS.booking, bookingId }));
  }

  logFailure(err: unknown): void {
    this.logger.error(`Event delivery failed: ${(err as Error).message}`);
  }
}
