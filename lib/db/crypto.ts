import crypto from 'crypto'

const algorithm = 'aes-256-gcm'

function getKey() {
  const secret = process.env.ENCRYPTION_SECRET

  if (!secret) {
    throw new Error('ENCRYPTION_SECRET is missing')
  }

  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptText(text: string) {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(algorithm, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ])

  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptText(encryptedText: string) {
  const key = getKey()
  const [ivHex, authTagHex, encryptedHex] = encryptedText.split(':')

  const decipher = crypto.createDecipheriv(
    algorithm,
    key,
    Buffer.from(ivHex, 'hex')
  )

  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final()
  ])

  return decrypted.toString('utf8')
}