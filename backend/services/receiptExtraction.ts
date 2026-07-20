import Anthropic from '@anthropic-ai/sdk'
import { DocumentFileType, ExtractedReceiptData } from 'abrechnung-common/types.js'
import { Types } from 'mongoose'
import ENV from '../env.js'
import { logger } from '../logger.js'
import DocumentFile from '../models/documentFile.js'

const SYSTEM_PROMPT =
  "Du bist ein Beleg-Analyse-Assistent. Antworte NUR mit einem JSON-Objekt, ohne Markdown-Backticks. Extrahiere aus dem Beleg: date (ISO 8601), amount (Zahl), currency (ISO 4217), merchant (String), description (sehr kurze deutsche Beschreibung der bezahlten Sache, z.B. 'Tanken', 'Hotelübernachtung', 'ÖPNV-Ticket', 'Geschäftsessen', 'Büromaterial'), category (String auf Deutsch, z.B. 'Verpflegung', 'Transport', 'Unterkunft', 'Sonstiges'). Füge ein Feld 'confidence' hinzu: 'high' wenn alle Felder klar lesbar sind, 'medium' bei Unsicherheiten, 'low' wenn wenig erkennbar. Fehlende Felder als null zurückgeben."

let client: Anthropic | undefined

/**
 * Returns extracted data, or null when extraction is permanently impossible
 * (no API key configured, file gone). Transient errors (API/network/parse)
 * are thrown so the queue can retry the job.
 */
export async function extractReceiptData(fileId: Types.ObjectId): Promise<ExtractedReceiptData | null> {
  if (!ENV.ANTHROPIC_API_KEY) {
    logger.warn('ANTHROPIC_API_KEY not set, skipping receipt extraction')
    return null
  }

  const file = await DocumentFile.findById(fileId).lean()
  if (!file) {
    logger.warn(`DocumentFile ${fileId} not found for receipt extraction`)
    return null
  }

  const base64 = Buffer.from(file.data.buffer as unknown as ArrayBuffer).toString('base64')
  const mediaType = file.type as DocumentFileType

  let contentBlock: Anthropic.MessageParam['content'][0]
  if (mediaType === 'application/pdf') {
    contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
  } else {
    contentBlock = { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }
  }

  client ||= new Anthropic({ apiKey: ENV.ANTHROPIC_API_KEY })

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: 'Analysiere diesen Beleg.' }] }]
  })

  const raw = response.content.find((b) => b.type === 'text')?.text ?? ''
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  logger.debug(`Receipt extraction raw response: ${text.slice(0, 200)}`)
  const parsed = JSON.parse(text)

  return {
    date: parsed.date ?? undefined,
    amount: typeof parsed.amount === 'number' ? parsed.amount : undefined,
    currency: parsed.currency ?? undefined,
    merchant: parsed.merchant ?? undefined,
    description: parsed.description ?? undefined,
    category: parsed.category ?? undefined,
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low'
  } satisfies ExtractedReceiptData
}
