import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserPrincipal } from '../interfaces/user-principal.interface.js';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): UserPrincipal => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  }
);
