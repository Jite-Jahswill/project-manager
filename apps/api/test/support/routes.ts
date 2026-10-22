import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../../src/auth/decorators';

export interface DiscoveredRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler: (...args: unknown[]) => unknown;
  isPublic: boolean;
}

/** Every HTTP route registered in the app (requires DiscoveryModule in the test app). */
export function discoverRoutes(app: INestApplication): DiscoveredRoute[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const out: DiscoveredRoute[] = [];
  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance as object;
    if (!instance) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, wrapper.metatype as object) ?? '');
    const proto = Object.getPrototypeOf(instance);
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      const sub = Reflect.getMetadata(PATH_METADATA, handler);
      if (sub === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] as DiscoveredRoute['method'];
      const isPublic = !!reflector.getAllAndOverride(IS_PUBLIC, [handler, wrapper.metatype as object]);
      out.push({ path: `/${base}/${sub}`.replace(/\/+/g, '/').replace(/\/$/, ''), method, handler, isPublic });
    }
  }
  return out;
}

/** Substitutes `:param` segments; throws if a parameter has no value. */
export function fillPath(path: string, params: Record<string, string>): string {
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    if (!(name in params)) throw new Error(`No value for :${name} in ${path}`);
    return params[name];
  });
}
