import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { DbService } from '../db/db.service.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly dbService: DbService,
  ) {}

  async signInWithGoogle(idToken: string) {
    const googleClientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const jwtSecret = this.config.get<string>('JWT_SECRET');
    if (!googleClientId || !jwtSecret) {
      throw new Error(
        'GOOGLE_CLIENT_ID and JWT_SECRET must be configured for authentication',
      );
    }

    let payload: TokenPayload | undefined;

    try {
      const ticket = await new OAuth2Client(googleClientId).verifyIdToken({
        idToken,
        audience: googleClientId,
      });
      payload = ticket.getPayload();
    } catch (error) {
      this.logger.warn(
        `Google ID token verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new UnauthorizedException('Invalid Google ID token');
    }

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException('Google account email is not found or not verified');
    }

    const user = await this.dbService.findOrCreateGoogleUser({
      subject: payload.sub,
      email: payload.email,
      displayName: payload.name ?? null,
      avatarUrl: payload.picture ?? null,
    });

    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email },
      { secret: jwtSecret, expiresIn: '90d' },
    );

    return { accessToken, user };
  }
}