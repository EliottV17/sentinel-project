import { Controller, Get, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PUBLIC_KEY } from '../src/common/decorators/public.decorator';

type RouteIdentity = `${string} ${string}`;

function paths(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [''] : [value];
}

function controllerRoutes(controllers: Function[]) {
  return controllers.flatMap((controller) => {
    const basePaths = paths(Reflect.getMetadata(PATH_METADATA, controller));
    return Object.getOwnPropertyNames(controller.prototype)
      .filter((name) => name !== 'constructor')
      .flatMap((name) => {
        const handler = controller.prototype[name];
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) return [];
        const routePaths = paths(Reflect.getMetadata(PATH_METADATA, handler));
        const isPublic = Reflect.getMetadata(PUBLIC_KEY, handler) === true;
        const hasJwtIntent = [
          ...((Reflect.getMetadata(GUARDS_METADATA, handler) as Function[] | undefined) ?? []),
          ...((Reflect.getMetadata(GUARDS_METADATA, controller) as Function[] | undefined) ?? []),
        ].includes(JwtAuthGuard);

        if (!isPublic && !hasJwtIntent) {
          throw new Error(`${controller.name}.${name} has no explicit access intent`);
        }

        return basePaths.flatMap((basePath) =>
          routePaths.map((routePath) => {
            const path = [basePath, routePath]
              .map((part) => part.replace(/^\/+|\/+$/g, ''))
              .filter(Boolean)
              .join('/');
            return {
              identity: `${RequestMethod[method]} /${path}` as RouteIdentity,
              isPublic,
            };
          }),
        );
      });
  });
}

@Controller('inventory-fixture')
class UnmarkedRouteController {
  @Get('unmarked')
  route() {
    return 'unmarked';
  }
}

describe('API route access inventory (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1', { exclude: ['/'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('enumerates every registered controller route and requires explicit access intent', () => {
    const modules = app.get(ModulesContainer);
    const controllers = [...modules.values()].flatMap((module) =>
      [...module.controllers.values()]
        .map((wrapper) => wrapper.metatype)
        .filter((metatype): metatype is Function => typeof metatype === 'function'),
    );
    const routes = controllerRoutes([...new Set(controllers)]);
    const identities = routes.map(({ identity }) => identity).sort();

    expect(identities).toEqual([
      'GET /',
      'GET /health',
      'GET /monitors',
      'GET /monitors/:id/alerts',
      'GET /monitors/:id/history',
      'GET /public/status',
      'GET /users/me',
      'PATCH /monitors/:id',
      'POST /auth/demo-login',
      'POST /auth/login',
      'POST /monitors',
      'POST /users',
      'DELETE /monitors/:id',
    ].sort());
    expect(
      routes
        .filter(({ isPublic }) => isPublic)
        .map(({ identity }) => identity)
        .sort(),
    ).toEqual([
      'GET /',
      'GET /health',
      'GET /public/status',
      'POST /auth/demo-login',
      'POST /auth/login',
      'POST /users',
    ].sort());
  });

  it('rejects a newly registered route without explicit public or protected intent', () => {
    expect(() => controllerRoutes([UnmarkedRouteController])).toThrow(
      'UnmarkedRouteController.route has no explicit access intent',
    );
  });

  it('enforces the global JWT default on an existing protected route', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/users/me');
    expect(response.status).toBe(401);
  });
});
