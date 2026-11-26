import type { Request } from 'express';

export interface AuthenticatedRequestUser {
  id: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  authTokenHash?: string;
  user?: AuthenticatedRequestUser;
}
