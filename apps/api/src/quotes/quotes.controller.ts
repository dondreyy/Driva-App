import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ParsedQuoteRequest, quoteRequestSchema, QuoteView } from '@driva/shared';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { QuotesService } from './quotes.service';

@Roles('client')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  /** Prices a trip. The price is computed here, never taken from the app. */
  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(quoteRequestSchema)) body: ParsedQuoteRequest,
  ): Promise<QuoteView> {
    return this.quotes.create(user.id, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<QuoteView> {
    return this.quotes.get(user.id, id);
  }
}
