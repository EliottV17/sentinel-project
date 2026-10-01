import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // If the request has an authenticated user, rate limit per user ID
    if (req.user && req.user.id) {
      return `user_${req.user.id}`;
    }

    // Unauthenticated (or auth routes): track by real client IP.
    // With Express 'trust proxy: 1', req.ip is computed via proxy-addr to evaluate
    // exactly one trusted hop from the reverse proxy (Nginx / Caddy), safely ignoring
    // any spoofed upstream IPs injected into X-Forwarded-For by the client.
    const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';

    return `ip_${clientIp}`;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse();
    if (res && throttlerLimitDetail.timeToBlockExpire) {
      this.setResponseHeader(res, 'Retry-After', throttlerLimitDetail.timeToBlockExpire);
    }
    await super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
