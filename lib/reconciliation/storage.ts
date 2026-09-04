import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import type { OwnedScope } from '@/lib/reconciliation/scope'
import type { DalResult } from '@/lib/reconciliation/types'

/**
 * Private reconciliation-file Storage (deposit images + Excel/CSV).
 * Objects live at `{userId}/{uuid}.{ext}`. Uploads go through supabaseAdmin
 * after withOwnedScope — never a public URL.
 */

export const DEPOSIT_IMAGE_BUCKET = 'reconciliation-deposits'
export const DEPOSIT_IMAGE_MAX_BYTES = 8 * 1024 * 1024
/** Cap on the JSON `image` string so we return JSON 413 instead of a platform plaintext body. */
export const IMAGE_JSON_MAX_CHARS = 3 * 1024 * 1024
export const IMAGE_TOO_LARGE_KO = '사진이 너무 큽니다. 더 작은 사진을 올려 주세요.'
export const DEPOSIT_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export const SPREADSHEET_MAX_BYTES = DEPOSIT_IMAGE_MAX_BYTES
export const SPREADSHEET_MIME = [
  'text/csv',
  'text/plain',
  'text/tab-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const

function dalOk<T>(data: T): DalResult<T> {
  return { ok: true, data }
}
function dalErr(status: number, error: string): DalResult<never> {
  return { ok: false, status, error }
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'text/csv': 'csv',
  'text/plain': 'csv',
  'text/tab-separated-values': 'csv',
  'application/csv': 'csv',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}

export function extForMime(mime: string): string {
  return MIME_EXT[mime] ?? 'jpg'
}

async function uploadOwnedObject(
  scope: OwnedScope,
  bytes: Uint8Array,
  contentType: string,
  ext: string
): Promise<DalResult<{ storagePath: string }>> {
  if (bytes.byteLength === 0) return dalErr(400, 'file is empty')
  if (bytes.byteLength > DEPOSIT_IMAGE_MAX_BYTES) {
    return dalErr(400, 'file must be 8MB or smaller')
  }
  const storagePath = `${scope.userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabaseAdmin.storage
    .from(DEPOSIT_IMAGE_BUCKET)
    .upload(storagePath, Buffer.from(bytes), { contentType, upsert: false })
  if (error) {
    console.error('[reconciliation] storage upload failed:', error.message)
    return dalErr(500, 'Could not store file')
  }
  return dalOk({ storagePath })
}

export async function storeDepositImage(
  scope: OwnedScope,
  bytes: Uint8Array,
  contentType: string
): Promise<DalResult<{ storagePath: string }>> {
  if (!(DEPOSIT_IMAGE_MIME as readonly string[]).includes(contentType)) {
    return dalErr(400, `image must be jpeg, png, webp, or gif (got ${contentType})`)
  }
  return uploadOwnedObject(scope, bytes, contentType, extForMime(contentType))
}

export async function storeSpreadsheetFile(
  scope: OwnedScope,
  bytes: Uint8Array,
  ext: 'csv' | 'xlsx' | 'xls'
): Promise<DalResult<{ storagePath: string }>> {
  const canonical =
    ext === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : ext === 'xls'
        ? 'application/vnd.ms-excel'
        : 'text/csv'
  return uploadOwnedObject(scope, bytes, canonical, ext)
}

/** Short-lived signed URL for owner viewing. Never a public path. */
export async function signDepositImage(
  scope: OwnedScope,
  storagePath: string,
  expiresSec = 300
): Promise<DalResult<{ signedUrl: string }>> {
  if (!storagePath.startsWith(`${scope.userId}/`)) {
    return dalErr(404, 'Not found')
  }
  const { data, error } = await supabaseAdmin.storage
    .from(DEPOSIT_IMAGE_BUCKET)
    .createSignedUrl(storagePath, expiresSec)
  if (error || !data?.signedUrl) {
    return dalErr(500, 'Could not sign deposit image')
  }
  return dalOk({ signedUrl: data.signedUrl })
}
