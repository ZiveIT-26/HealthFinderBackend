import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/auth.types.js';
import { AccessTokenAuthGuard } from '../../auth/access-token-auth.guard.js';
import { AuthService } from '../../services/auth/auth.service.js';


@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('google')
  signInWithGoogle(@Body() body: { idToken: string }) {
    if (body.idToken.trim().length === 0) {
      throw new BadRequestException('idToken is required');
    }

    return this.authService.signInWithGoogle(body.idToken);
  }

  @Post('test-login')
  signInForTesting() {
    return this.authService.signInForTesting();
  }

  @Post('logout')
  @UseGuards(AccessTokenAuthGuard)
  logout(@Req() request: AuthenticatedRequest) {
    if (!request.authTokenHash) {
      throw new UnauthorizedException('Authentication is required');
    }

    return this.authService.logout(request.authTokenHash);
  }
}
