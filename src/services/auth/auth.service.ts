import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { DbService } from '../db/db.service.js';

@Injectable()
export class AuthService {
  private readonly testUserId = '00000000-0000-0000-0000-000000000001';
  private readonly testEmail = 'test@healthfinder.local';

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

  async signInForTesting() {
    const enabled = this.config.get<string>('TEST_AUTH_ENABLED') === 'true';
    const nodeEnv = this.config.get<string>('NODE_ENV');
    if (!enabled || nodeEnv === 'production') {
      throw new ForbiddenException('Test authentication is disabled');
    }

    const jwtSecret = this.config.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET must be configured for authentication');
    }

    const user = await this.dbService.findOrCreateTestUser({
      id: this.testUserId,
      email: this.testEmail,
    });

    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email },
      { secret: jwtSecret, expiresIn: '90d' },
    );

    return { accessToken, user };
  }
}