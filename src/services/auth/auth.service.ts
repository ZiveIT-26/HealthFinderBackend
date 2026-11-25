import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { hashAccessToken } from '../../auth/access-token.js';
import { DbService } from '../db/db.service.js';

@Injectable()
export class AuthService {
  private readonly testUserId = '00000000-0000-0000-0000-000000000001';
  private readonly testEmail = 'test@healthfinder.local';

  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly dbService: DbService,
  ) {}

  async signInWithGoogle(idToken: string) {
    const googleClientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!googleClientId) {
      throw new Error('GOOGLE_CLIENT_ID must be configured for authentication');
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

    const accessToken = await this.issueAccessToken(user.id);

    return { accessToken, user };
  }

  async signInForTesting() {
    const enabled = this.config.get<string>('TEST_AUTH_ENABLED') === 'true';
    const nodeEnv = this.config.get<string>('NODE_ENV');
    if (!enabled || nodeEnv === 'production') {
      throw new ForbiddenException('Test authentication is disabled');
    }

    const user = await this.dbService.findOrCreateTestUser({
      id: this.testUserId,
      email: this.testEmail,
    });

    const accessToken = await this.issueAccessToken(user.id);

    return { accessToken, user };
  }

  async logout(tokenHash: string): Promise<{ success: true }> {
    await this.dbService.deleteAccessToken(tokenHash);
    return { success: true };
  }

  private async issueAccessToken(userId: string): Promise<string> {
    const accessToken = randomBytes(32).toString('base64url');
    await this.dbService.createAccessToken(hashAccessToken(accessToken), userId);
    return accessToken;
  }
}
