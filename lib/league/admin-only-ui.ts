/**
 * Public-hub elements gated only by admin status.
 * Preview-as-user must hide every row except the toggle itself.
 */
export const ADMIN_ONLY_PUBLIC_UI = [
  { id: 'admin-stock-lane', where: 'world and Korean finance stocks', what: '글로벌/한국 lane toggle' },
  { id: 'admin-kr-stock-generate', where: 'Korean stocks', what: 'admin KRSTOCK generation' },
  { id: 'language-toggle-kr', where: 'Korean lane', what: 'language selector (KR admins only)' },
  { id: 'kr-election-admin-banners', where: 'admin layout', what: 'KR election stage banners' },
  { id: 'admin-preview-as-user', where: 'door pages', what: '일반 사용자로 보기 toggle' },
  { id: 'admin-test-badge', where: 'admin grade / lists', what: '테스트 badge on is_test rounds' },
] as const
