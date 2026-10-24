import type { Server as HttpServer } from 'node:http';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/** Socket.IO with the same browser origins as the REST API (none by default; the apps are native). */
export class DrivaIoAdapter extends IoAdapter {
  constructor(
    httpServer: HttpServer,
    private readonly origins: string[],
  ) {
    super(httpServer);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins.length ? this.origins : false },
    });
  }
}
