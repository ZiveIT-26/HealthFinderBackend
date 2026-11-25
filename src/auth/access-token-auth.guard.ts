import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DbService } from '../services/db/db.service.js';
import { hashAccessToken } from './access-token.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class AccessTokenAuthGuard implements CanActivate {
  constructor(private readonly dbService: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : undefined;

    if (!token) {
      throw new UnauthorizedException('Authentication is required');
    }

    const tokenHash = hashAccessToken(token);
    const user = await this.dbService.refreshAccessToken(tokenHash);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    request.authTokenHash = tokenHash;
    request.user = user;
    return true;
  }
}
