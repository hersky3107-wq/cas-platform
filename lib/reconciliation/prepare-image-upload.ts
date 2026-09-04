/**
 * Shrink a phone photo before POSTing to the reconciliation image routes.
 * Vercel serverless bodies cap at ~4.5MB; a data-URL JSON payload blows
 * past that on an unscaled camera JPEG.
 */

const SKIP_RESIZE_BYTES = 1024 * 1024
const MAX_EDGE_PX = 1600
const JPEG_QUALITY = 0.8

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not read image'))
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.readAsDataURL(blob)
  })
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = src
  })
}

export async function prepareImageForUpload(
  file: File
): Promise<{ dataUrl: string; mediaType: string }> {
  if (file.size < SKIP_RESIZE_BYTES) {
    return {
      dataUrl: await readAsDataUrl(file),
      mediaType: file.type || 'image/jpeg',
    }
  }

  const originalUrl = await readAsDataUrl(file)
  const img = await loadImageElement(originalUrl)
  const longest = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height)
  const scale = longest > MAX_EDGE_PX ? MAX_EDGE_PX / longest : 1
  const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale))
  const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not encode image')
  ctx.drawImage(img, 0, 0, width, height)

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return { dataUrl, mediaType: 'image/jpeg' }
}
