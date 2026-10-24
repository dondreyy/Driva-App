import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { MAX_UPLOAD_BYTES } from '@driva/shared';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators';
import { FILE_STORAGE, FileStorage, LocalFileStorage } from './file-storage';

/**
 * Serves signed URLs for LocalFileStorage. The signed token is the only credential, the same
 * as an S3 presigned URL. Not used when files are on S3.
 */
@Public()
@Controller('files')
export class FilesController {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  @Put(':token')
  @HttpCode(200)
  async upload(@Param('token') token: string, @Req() req: Request): Promise<{ ok: true }> {
    const local = this.local();
    const grant = local.verify(token, 'put');
    if (!grant) throw new ForbiddenException('This upload link is not valid or has expired');
    if (req.headers['content-type'] !== grant.ct) {
      throw new ForbiddenException('Content-Type does not match the upload link');
    }
    await local.write(grant.key, await readBody(req));
    return { ok: true };
  }

  @Get(':token')
  download(@Param('token') token: string, @Res() res: Response): void {
    const local = this.local();
    const grant = local.verify(token, 'get');
    if (!grant) throw new ForbiddenException('This link is not valid or has expired');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(local.pathFor(grant.key), (err?: Error) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }

  private local(): LocalFileStorage {
    if (!(this.storage instanceof LocalFileStorage)) throw new NotFoundException();
    return this.storage;
  }
}

async function readBody(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('Photos must be under 10 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
