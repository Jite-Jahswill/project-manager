/**
 * Mandatory tests 1, 6 and 8 (plus search/report/audit parts of 7): one
 * organization can never read or change another's data through the API, whatever
 * IDs or body fields the client sends.
 */
import { INestApplication } from '@nestjs/common';
import { addMember, bearer, createOrg, createTestApp, http, resetDatabase, roleId, signUp, TestOrg } from './support/harness';

describe('Cross-tenant isolation through the API', () => {
  let app: INestApplication;
  let a: TestOrg;
  let b: TestOrg;
  let productB: string;
  let roleB: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    a = await createOrg(app, await signUp(app, 'iso-owner-a'), 'iso-a');
    b = await createOrg(app, await signUp(app, 'iso-owner-b'), 'iso-b');
    productB = (await http(app).post(`/v1/orgs/${b.id}/products`).set(bearer(b.owner)).send({ sku: 'SECRET-1', name: 'B secret product' }).expect(201)).body.id;
    roleB = await roleId(app, b, 'Cashier');
  });
  afterAll(() => app.close());

  it.each([
    ['GET', ''], ['GET', '/branches'], ['GET', '/members'], ['GET', '/roles'], ['GET', '/products'],
    ['GET', '/audit-events'], ['GET', '/subscription'],
  ])("owner of A gets 403 on B's %s %s", async (_method, path) => {
    const res = await http(app).get(`/v1/orgs/${b.id}${path}`).set(bearer(a.owner));
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });

  it("owner of A cannot write into B", async () => {
    await http(app).post(`/v1/orgs/${b.id}/products`).set(bearer(a.owner)).send({ sku: 'X1', name: 'injected' }).expect(403);
    await http(app).post(`/v1/orgs/${b.id}/branches`).set(bearer(a.owner)).send({ name: 'injected', code: 'INJ' }).expect(403);
    await http(app).post(`/v1/orgs/${b.id}/roles`).set(bearer(a.owner)).send({ name: 'injected', permissions: [] }).expect(403);
  });

  it("non-existent and foreign organizations are indistinguishable", async () => {
    const foreign = await http(app).get(`/v1/orgs/${b.id}`).set(bearer(a.owner));
    const missing = await http(app).get('/v1/orgs/7c0d3a1e-1111-4222-8333-444455556666').set(bearer(a.owner));
    expect(foreign.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(foreign.body).toEqual(missing.body);
  });

  it("B's resource IDs used under A's path are not found (RLS hides them)", async () => {
    await http(app).get(`/v1/orgs/${a.id}/products/${productB}`).set(bearer(a.owner)).expect(404);
    await http(app).patch(`/v1/orgs/${a.id}/products/${productB}`).set(bearer(a.owner)).send({ name: 'pwned' }).expect(404);
    await http(app).post(`/v1/orgs/${a.id}/products/${productB}/archive`).set(bearer(a.owner)).expect(404);
    await http(app).get(`/v1/orgs/${a.id}/branches/${b.mainBranchId}/stock`).set(bearer(a.owner)).expect(404);
    await http(app)
      .post(`/v1/orgs/${a.id}/branches/${b.mainBranchId}/stock/adjustments`).set(bearer(a.owner)).set('Idempotency-Key', 'cross-tenant-1')
      .send({ productId: productB, quantityDelta: '5', reason: 'smuggle' }).expect(404);
    const after = await http(app).get(`/v1/orgs/${b.id}/products/${productB}`).set(bearer(b.owner)).expect(200);
    expect(after.body.name).toBe('B secret product');
  });

  it("client-supplied tenant fields in bodies are rejected, not trusted", async () => {
    const res = await http(app).post(`/v1/orgs/${a.id}/products`).set(bearer(a.owner)).send({ sku: 'T1', name: 't', organizationId: b.id });
    expect(res.status).toBe(400);
    const res2 = await http(app).patch(`/v1/orgs/${a.id}/products/${productB}`).set(bearer(a.owner)).send({ organizationId: a.id });
    expect(res2.status).toBe(400);
  });

  it("cannot assign B's role or B's branch to a member of A", async () => {
    const member = await addMember(app, a, 'iso-member', 'Read-only viewer');
    await http(app).put(`/v1/orgs/${a.id}/members/${member.membershipId}/roles`).set(bearer(a.owner))
      .send({ assignments: [{ roleId: roleB }] }).expect(404);
    const viewer = await roleId(app, a, 'Read-only viewer');
    await http(app).put(`/v1/orgs/${a.id}/members/${member.membershipId}/roles`).set(bearer(a.owner))
      .send({ assignments: [{ roleId: viewer, branchId: b.mainBranchId }] }).expect(404);
    await http(app).post(`/v1/orgs/${a.id}/invitations`).set(bearer(a.owner)).send({ email: 'someone@example.test', roleId: roleB }).expect(404);
  });

  it("search in A never returns B's products", async () => {
    const res = await http(app).get(`/v1/orgs/${a.id}/products?q=SECRET`).set(bearer(a.owner)).expect(200);
    expect(res.body).toEqual([]);
  });

  it("A's audit log contains only A's events", async () => {
    const res = await http(app).get(`/v1/orgs/${a.id}/audit-events?limit=100`).set(bearer(a.owner)).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((e: { organizationId: string }) => e.organizationId === a.id)).toBe(true);
  });

  it("the org switcher lists only the user's own organizations", async () => {
    const res = await http(app).get('/v1/me/organizations').set(bearer(a.owner)).expect(200);
    expect(res.body.map((o: { id: string }) => o.id)).toEqual([a.id]);
  });

  it("an invitation token for B cannot be redirected to A or used by another user", async () => {
    await http(app).post(`/v1/orgs/${b.id}/invitations`).set(bearer(b.owner)).send({ email: 'target@example.test' }).expect(201);
    const intruder = await signUp(app, 'intruder');
    const { MailService } = await import('../src/mail/mail.service');
    const msg = app.get(MailService).captured.filter((m) => m.to === 'target@example.test').at(-1)!;
    const token = decodeURIComponent(msg.text.match(/#token=([^\s]+)/)![1]);
    // Wrong user (email mismatch): the database hides the invitation from anyone but its
    // addressee, so the response is the same generic error as for a bogus token.
    const wrongUser = await http(app).post('/v1/invitations/accept').set(bearer(intruder)).send({ token }).expect(400);
    expect(wrongUser.body.code).toBe('invalid_token');
    // Same secret, organization ID swapped to A.
    const swapped = `${a.id}.${token.split('.')[1]}`;
    await http(app).post('/v1/invitations/accept').set(bearer(intruder)).send({ token: swapped }).expect(400);
  });
});
