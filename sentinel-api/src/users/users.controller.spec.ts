import { UsersController } from './users.controller';

describe('UsersController demo mutation boundary', () => {
  it('keeps password, email, and account deletion mutation routes absent', () => {
    const routes = Object.getOwnPropertyNames(UsersController.prototype).filter(
      (name) => name !== 'constructor',
    );
    const mutations = routes.filter((name) =>
      /password|email|delete|remove|update/i.test(name),
    );
    expect(mutations).toEqual([]);
    expect(routes).toEqual(expect.arrayContaining(['register', 'getMe']));
  });

  it.each([
    ['POST', '/users/change-password'],
    ['PATCH', '/users/email'],
    ['DELETE', '/users/me'],
  ])('does not expose demo account mutation %s %s', (method, route) => {
    const { PATH_METADATA, METHOD_METADATA } = require('@nestjs/common/constants');
    const base = Reflect.getMetadata(PATH_METADATA, UsersController);
    const expectedMethod = method === 'POST' ? 1 : method === 'PATCH' ? 4 : 3;
    const handlers = Object.getOwnPropertyNames(UsersController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({
        path: Reflect.getMetadata(PATH_METADATA, UsersController.prototype[name]),
        method: Reflect.getMetadata(METHOD_METADATA, UsersController.prototype[name]),
      }));
    expect(handlers).not.toContainEqual({ path: route.replace(`/${base}/`, ''), method: expectedMethod });
  });
});
