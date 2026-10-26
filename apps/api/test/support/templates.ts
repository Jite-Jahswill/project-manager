import { templateSnapshot } from '../../src/authz/role-template-history';

/** A frozen role template snapshot's permissions (sorted), for building legacy organizations in tests. */
export const snapshot = (version: number, templateKey: string): string[] => [...(templateSnapshot(version)?.templates[templateKey] ?? [])].sort();
