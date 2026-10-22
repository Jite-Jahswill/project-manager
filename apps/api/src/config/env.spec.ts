import { loadConfig } from './env';

const base = {
  NODE_ENV: 'development',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  DATABASE_URL: 'postgresql://ventidoc_app:pw@localhost:5434/ventidoc',
  AUTH_DATABASE_URL: 'postgresql://ventidoc_auth:pw@localhost:5434/ventidoc',
  APP_PUBLIC_URL: 'http://localhost:3001',
};

describe('config validation', () => {
  it('accepts a valid development config', () => {
    expect(loadConfig(base).port).toBe(3000);
  });
  it('refuses short JWT secrets and placeholders', () => {
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/32 bytes/);
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'CHANGE_ME' })).toThrow(/required/);
  });
  it('refuses to connect as anything other than the RLS-bound app role', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'postgresql://postgres:pw@localhost/ventidoc' })).toThrow(/ventidoc_app/);
    expect(() => loadConfig({ ...base, DATABASE_URL: 'postgresql://ventidoc_migrator:pw@localhost/ventidoc' })).toThrow(/ventidoc_app/);
  });
  it('refuses a credential-store connection that is not the ventidoc_auth role', () => {
    expect(() => loadConfig({ ...base, AUTH_DATABASE_URL: 'postgresql://ventidoc_app:pw@localhost/ventidoc' })).toThrow(/ventidoc_auth/);
    expect(() => loadConfig({ ...base, AUTH_DATABASE_URL: undefined })).toThrow(/required/);
  });

  it('refuses production until production transports exist', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/not supported yet/);
  });
});
