import {
  BadRequestException,
  Body,
  Controller,
  Post,
} from '@nestjs/common';
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
}
