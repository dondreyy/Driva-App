import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { MatchingService } from './matching.service';

const SWEEP_EVERY_MS = 1000;

/** Runs the matching sweep every second, so offers expire on time and the next driver is asked. */
@Injectable()
export class MatchingWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MatchingWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly matching: MatchingService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.matchingWorker) return;
    this.timer = setInterval(() => void this.tick(), SWEEP_EVERY_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.matching.sweep();
    } catch (err) {
      this.logger.error(`Matching sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
