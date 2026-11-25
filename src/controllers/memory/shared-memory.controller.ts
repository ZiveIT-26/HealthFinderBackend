import {
  Controller,
  Delete,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenAuthGuard } from '../../auth/access-token-auth.guard.js';
import { DbService } from '../../services/db/db.service.js';
import type { Request } from 'express';
import type { AuthenticatedRequestUser } from '../../auth/auth.types.js';

@Controller('shared-memory')
@UseGuards(AccessTokenAuthGuard)
export class SharedMemoryController {
  constructor(private readonly dbService: DbService) {}

  @Get()
  getSharedMemories(
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ) {
    return this.dbService.getMemories(request.user.id);
  }

  @Delete()
  deleteSharedMemories(
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ) {
    return this.dbService.deleteMemories(request.user.id);
  }

  @Delete(':memoryId')
  deleteSharedMemory(
    @Param('memoryId') memoryId: string,
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ) {
    return this.dbService.deleteMemory(request.user.id, memoryId);
  }
}
