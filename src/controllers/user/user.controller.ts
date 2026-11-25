import {
  Controller, Delete,
  Get,
  Req,
} from '@nestjs/common';
import { DbService } from '../../services/db/db.service.js';
import type { Request } from 'express';
import type { AuthenticatedRequestUser } from '../../auth/auth.types.js';

@Controller('user')
export class AuthController {
  constructor(private readonly dbService: DbService) {}

  @Get()
  getCurrentUser(
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ) {
    return this.dbService
      .getUser(request.user.id)
      .then(({ id, email, displayName, avatarUrl, createdAt }) => ({
        id,
        email,
        displayName,
        avatarUrl,
        createdAt,
      }));
  }

  @Delete()
  deleteUserAccount(
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ) {
    return this.dbService.deleteUser(request.user.id);
  }
}
