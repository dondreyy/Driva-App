import { Logger, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { TokensService } from '../auth/tokens.service';
import { EventsService } from './events.service';

/**
 * Live updates for the apps at /v1/socket. A socket must send a valid access token and only
 * joins its own user's room, so nobody hears about other people's trips.
 */
@WebSocketGateway({ path: '/v1/socket' })
export class EventsGateway implements OnGatewayConnection, OnModuleInit {
  private readonly logger = new Logger(EventsGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly tokens: TokensService,
    private readonly events: EventsService,
  ) {}

  onModuleInit(): void {
    // The server is set once the gateway is bound; attach on the next tick.
    setImmediate(() => this.events.attach(this.server));
  }

  async handleConnection(socket: Socket): Promise<void> {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    try {
      if (typeof token !== 'string') throw new Error('no token');
      const user = await this.tokens.verifyAccessToken(token);
      await socket.join(`user:${user.id}`);
    } catch {
      socket.emit('error', { message: 'Sign in to continue' });
      socket.disconnect(true);
    }
  }
}
