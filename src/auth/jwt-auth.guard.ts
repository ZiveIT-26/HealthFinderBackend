import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthenticatedRequestUser } from './auth.types.js';

type AuthenticatedRequest = Request & {
  user?: AuthenticatedRequestUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : undefined;
    const secret = this.config.get<string>('JWT_SECRET');

    if (!token || !secret) {
      throw new UnauthorizedException('Authentication is required');
    }

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub?: unknown;
        email?: unknown;
      }>(token, { secret });

      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
        throw new UnauthorizedException('Invalid access token');
      }

      request.user = { id: payload.sub, email: payload.email };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
