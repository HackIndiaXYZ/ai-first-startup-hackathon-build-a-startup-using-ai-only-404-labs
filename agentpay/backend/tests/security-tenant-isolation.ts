// Multi-Tenant Isolation Security Test Suite (Phase 8 Hardening)
// Verifies cryptographic and organizational boundaries between tenants.
// Proves that Organization Alpha cannot view, alter, approve, or execute
// payments, policies, agents, approvals, or ledger entries of Organization Beta.

const BASE = 'http://localhost:3001/v1';

async function request(url: string, options: RequestInit = {}, body?: any): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(url, {
    ...options,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: Record<string, any> = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { httpStatus: res.status, ...data, status: data.status !== undefined ? data.status : res.status };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runTenantIsolationSuite() {
  console.log('\n================================================================');
  console.log('🛡️ RUNNING MULTI-TENANT ISOLATION SECURITY AUDIT SUITE');
  console.log('================================================================\n');

  const testId = Date.now().toString(36);

  // ── 1. SETUP: PROVISION ORG ALPHA ──────────────────────────────
  console.log('--- 1. PROVISIONING TENANT ALPHA & BETA ---');
  const regAlpha = await request(`${BASE}/auth/register`, { method: 'POST' }, {
    email: `alpha_admin_${testId}@alpha.corp`,
    password: 'Password123!',
    name: 'Admin Alpha',
    organization_name: `Alpha Corp ${testId}`,
  });
  assert(regAlpha.httpStatus === 201, 'Organization Alpha registered');
  const tokenAlpha = regAlpha.data.token;
  const headersAlpha = { Authorization: `Bearer ${tokenAlpha}` };

  // ── 2. SETUP: PROVISION ORG BETA ───────────────────────────────
  const regBeta = await request(`${BASE}/auth/register`, { method: 'POST' }, {
    email: `beta_admin_${testId}@beta.corp`,
    password: 'Password123!',
    name: 'Admin Beta',
    organization_name: `Beta Corp ${testId}`,
  });
  assert(regBeta.httpStatus === 201, 'Organization Beta registered');
  const tokenBeta = regBeta.data.token;
  const headersBeta = { Authorization: `Bearer ${tokenBeta}` };

  // Create Agent in Org Alpha
  const agentAlphaRes = await request(`${BASE}/agents`, { method: 'POST', headers: headersAlpha }, {
    name: 'Alpha DevOps Agent',
    role: 'Infrastructure Procurement',
  });
  const agentAlpha = agentAlphaRes.data;

  // Create Agent in Org Beta
  const agentBetaRes = await request(`${BASE}/agents`, { method: 'POST', headers: headersBeta }, {
    name: 'Beta Finance Agent',
    role: 'Treasury Procurement',
  });
  const agentBeta = agentBetaRes.data;

  // Issue Keys
  const keyAlphaRes = await request(`${BASE}/agents/${agentAlpha.id}/credentials`, { method: 'POST', headers: headersAlpha }, {});
  const keyAlpha = keyAlphaRes.data.api_key;
  const agentAlphaHeaders = { 'X-API-Key': keyAlpha };

  const keyBetaRes = await request(`${BASE}/agents/${agentBeta.id}/credentials`, { method: 'POST', headers: headersBeta }, {});
  const keyBeta = keyBetaRes.data.api_key;
  const agentBetaHeaders = { 'X-API-Key': keyBeta };

  // Create Policy in Org Beta (Requires approval > ₹500)
  const policyBetaRes = await request(`${BASE}/policies`, { method: 'POST', headers: headersBeta }, {
    name: 'Beta Treasury Policy',
    agent_id: agentBeta.id,
    max_amount_paise: 500000,
    daily_budget_paise: 2000000,
    approval_threshold_paise: 50000, // ₹500
    allowed_categories: ['treasury', 'saas'],
  });
  assert(policyBetaRes.httpStatus === 201, 'Policy Beta created');
  const policyBeta = policyBetaRes.data;

  // Org Beta Agent creates intent requiring approval (₹1,500)
  const intentBetaRes = await request(`${BASE}/payment-intents`, {
    method: 'POST',
    headers: agentBetaHeaders,
  }, {
    amount_paise: 150000,
    currency: 'INR',
    merchant: 'Datadog Enterprise',
    purpose: 'Monitoring tier',
    category: 'saas',
    idempotency_key: `beta_intent_${testId}`,
  });
  assert(intentBetaRes.httpStatus === 201, 'Intent Beta created (status: PENDING_APPROVAL)');
  const intentBeta = intentBetaRes.data;
  assert(intentBeta.status === 'PENDING_APPROVAL', 'Intent Beta is PENDING_APPROVAL');

  // Fetch Beta approval task ID
  const approvalsBetaList = await request(`${BASE}/approvals`, { method: 'GET', headers: headersBeta });
  assert(approvalsBetaList.data.length >= 1, 'Approval task queued in Beta');
  const approvalBeta = approvalsBetaList.data.find((a: any) => a.payment_intent_id === intentBeta.id);
  assert(approvalBeta !== undefined, 'Beta approval task located');

  // ── 3. TENANT ISOLATION: AGENT BOUNDARIES ──────────────────────
  console.log('\n--- 2. AGENT ISOLATION CHECKS ---');
  // Alpha tries to GET Beta agent
  const getBetaByAlpha = await request(`${BASE}/agents/${agentBeta.id}`, { method: 'GET', headers: headersAlpha });
  assert(getBetaByAlpha.httpStatus === 404, 'Cross-tenant GET agent blocked with 404');

  // Alpha tries to DISABLE Beta agent
  const disableBetaByAlpha = await request(`${BASE}/agents/${agentBeta.id}/disable`, {
    method: 'POST',
    headers: headersAlpha,
  }, { reason: 'Malicious disable attempt' });
  assert(disableBetaByAlpha.httpStatus === 404, 'Cross-tenant DISABLE agent blocked with 404');

  // ── 4. TENANT ISOLATION: POLICY BOUNDARIES ─────────────────────
  console.log('\n--- 3. POLICY ISOLATION CHECKS ---');
  // Alpha tries to GET Beta policy
  const getPolicyByAlpha = await request(`${BASE}/policies/${policyBeta.id}`, { method: 'GET', headers: headersAlpha });
  assert(getPolicyByAlpha.httpStatus === 404, 'Cross-tenant GET policy blocked with 404');

  // Alpha tries to CREATE policy attached to Beta agent
  const createPolicyCross = await request(`${BASE}/policies`, { method: 'POST', headers: headersAlpha }, {
    name: 'Hijack Policy',
    agent_id: agentBeta.id,
    max_amount_paise: 1000000,
  });
  assert(createPolicyCross.httpStatus === 404, 'Cross-tenant policy creation rejected with 404 (Agent not found in tenant)');

  // ── 5. TENANT ISOLATION: PAYMENT INTENT BOUNDARIES ─────────────
  console.log('\n--- 4. PAYMENT INTENT ISOLATION CHECKS ---');
  // Alpha tries to GET Beta payment intent
  const getIntentByAlpha = await request(`${BASE}/payment-intents/${intentBeta.id}`, { method: 'GET', headers: headersAlpha });
  assert(getIntentByAlpha.httpStatus === 404, 'Cross-tenant GET payment intent blocked with 404');

  // ── 6. TENANT ISOLATION: APPROVAL SYSTEM HIJACK DEFENSE ────────
  console.log('\n--- 5. APPROVAL HIJACK DEFENSE CHECKS ---');
  // Alpha tries to APPROVE Beta payment
  const approveBetaByAlpha = await request(`${BASE}/approvals/${approvalBeta.id}/approve`, {
    method: 'POST',
    headers: headersAlpha,
  }, { comment: 'Illegal approval by Org Alpha' });
  assert(approveBetaByAlpha.httpStatus === 404, 'Cross-tenant approval attempt blocked with 404');

  // Alpha tries to REJECT Beta payment
  const rejectBetaByAlpha = await request(`${BASE}/approvals/${approvalBeta.id}/reject`, {
    method: 'POST',
    headers: headersAlpha,
  }, { comment: 'Illegal rejection by Org Alpha' });
  assert(rejectBetaByAlpha.httpStatus === 404, 'Cross-tenant rejection attempt blocked with 404');

  // ── 7. TENANT ISOLATION: LEDGER & TRANSACTION EXPLORER ─────────
  console.log('\n--- 6. LEDGER & AUDIT TRAIL ISOLATION CHECKS ---');
  // Beta user approves Beta payment legitimately
  const legitimateApprove = await request(`${BASE}/approvals/${approvalBeta.id}/approve`, {
    method: 'POST',
    headers: headersBeta,
  }, { comment: 'Legitimate approval by Beta CFO' });
  assert(legitimateApprove.httpStatus === 200, 'Beta approval successfully executed');

  // Alpha tries to inspect transactions
  const txAlphaRes = await request(`${BASE}/transactions`, { method: 'GET', headers: headersAlpha });
  assert(txAlphaRes.data.length === 0, 'Alpha transaction list contains zero entries from Beta');

  // Alpha tries to inspect ledger
  const ledgerAlphaRes = await request(`${BASE}/ledger`, { method: 'GET', headers: headersAlpha });
  assert(ledgerAlphaRes.data.length === 0, 'Alpha ledger contains zero debit entries from Beta');

  console.log('\n================================================================');
  console.log('🎉 ALL MULTI-TENANT ISOLATION & BOUNDARY CHECKS PASSED!');
  console.log('================================================================\n');
}

runTenantIsolationSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Security Tenant Isolation Suite Failed:', err);
    process.exit(1);
  });
