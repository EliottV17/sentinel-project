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
    // When Express has 'trust proxy' enabled, req.ips contains the chain of client IPs.
    // req.ips[0] is the original client IP before downstream proxies.
    const clientIp =
      (Array.isArray(req.ips) && req.ips.length > 0 ? req.ips[0] : null) ||
      req.ip ||
      req.socket?.remoteAddress ||
      '127.0.0.1';

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
