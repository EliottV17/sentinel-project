import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PUBLIC_KEY } from '../../common/decorators/public.decorator';

function contextFor(handler: Function, controller: Function = class {}): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard(new Reflector());
  });

  it('skips JWT authentication for a public handler', () => {
    const handler = jest.fn();
    SetMetadata(PUBLIC_KEY, true)(handler);

    expect(guard.canActivate(contextFor(handler))).toBe(true);
  });

  it('lets handler metadata override controller public metadata', () => {
    const handler = jest.fn();
    class ControllerWithPublicMetadata {}
    SetMetadata(PUBLIC_KEY, true)(ControllerWithPublicMetadata);
    SetMetadata(PUBLIC_KEY, false)(handler);
    const guardPrototype = Object.getPrototypeOf(JwtAuthGuard.prototype);
    const parentCanActivate = jest
      .spyOn(guardPrototype, 'canActivate')
      .mockReturnValue(true);
    const requestContext = contextFor(handler, ControllerWithPublicMetadata);

    expect(guard.canActivate(requestContext)).toBe(true);
    expect(parentCanActivate).toHaveBeenCalledWith(requestContext);

    parentCanActivate.mockRestore();
  });

  it('honors public metadata on the controller when the handler has none', () => {
    const handler = jest.fn();
    class PublicController {}
    SetMetadata(PUBLIC_KEY, true)(PublicController);

    expect(guard.canActivate(contextFor(handler, PublicController))).toBe(true);
  });

  it('preserves passport authentication for a protected route', () => {
    const handler = jest.fn();
    const requestContext = contextFor(handler);
    const guardPrototype = Object.getPrototypeOf(JwtAuthGuard.prototype);
    const parentCanActivate = jest
      .spyOn(guardPrototype, 'canActivate')
      .mockReturnValue(true);

    expect(guard.canActivate(requestContext)).toBe(true);
    expect(parentCanActivate).toHaveBeenCalledWith(requestContext);

    parentCanActivate.mockRestore();
  });
});
