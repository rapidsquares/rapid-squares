// Who is calling, which company they belong to, and what they're allowed to do.
import { db, eq, userFromToken } from './supabase.js';
import { fail } from './http.js';

export const ALL_PERMS = ['orders.create', 'orders.view_all', 'orders.download', 'branding.edit', 'billing.manage', 'users.manage'];

export const PRESETS = {
  admin: ['orders.create', 'orders.view_all', 'orders.download', 'branding.edit', 'billing.manage', 'users.manage'],
  manager: ['orders.create', 'orders.view_all', 'orders.download', 'branding.edit'],
  estimator: ['orders.create', 'orders.download'],
  viewer: ['orders.download']
};

export function effectivePerms(user) {
  return user.role === 'owner' ? ALL_PERMS.slice() : (user.permissions || []).filter((p) => ALL_PERMS.includes(p));
}
export function cleanPerms(list) { return (Array.isArray(list) ? list : []).filter((p) => ALL_PERMS.includes(p)); }

function tokenFrom(req) {
  const h = String(req.headers.authorization || '');
  return /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '').trim() : '';
}

// Signed in, but maybe not part of a company yet (first sign-up, or accepting an invite).
export async function signedIn(req) {
  return userFromToken(tokenFrom(req));
}

// Signed in AND a member of a company. Every company-scoped route starts here.
export async function member(req) {
  const auth = await signedIn(req);
  const user = await db.one('users', { id: eq(auth.id) });
  if (!user) fail(409, 'needs_company', 'Finish setting up your account to continue.');
  const company = await db.one('companies', { id: eq(user.company_id) });
  if (!company) fail(409, 'needs_company', 'Your company account couldn’t be found. Contact support.');
  const perms = effectivePerms(user);
  return {
    auth, user, company, perms,
    can: (p) => perms.includes(p),
    need(p) { if (!perms.includes(p)) fail(403, 'forbidden', 'You don’t have permission to do that. Ask your company admin.'); }
  };
}

export function userOut(u) {
  return {
    id: u.id, company_id: u.company_id, full_name: u.full_name, email: u.email, phone: u.phone, office_phone: u.office_phone,
    preferred_contact: u.preferred_contact, timezone: u.timezone, job_title: u.job_title, avatar_url: u.avatar_url,
    role: u.role, preset: u.preset, permissions: effectivePerms(u), monthly_order_limit: u.monthly_order_limit, created_at: u.created_at
  };
}
