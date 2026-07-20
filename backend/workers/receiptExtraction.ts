import { Queue, Worker } from 'bullmq'
import { Types } from 'mongoose'
import ENV from '../env.js'
import i18n from '../i18n.js'
import { sendPushNotification } from '../integrations/notifications/push.js'
import { logger } from '../logger.js'
import PendingReceipt from '../models/pendingReceipt.js'
import User from '../models/user.js'
import { extractReceiptData } from '../services/receiptExtraction.js'

export interface ReceiptExtractionJobData {
  pendingReceiptId: string
}

const QUEUE_NAME = 'receipt-extraction'

export const receiptExtractionQueue = new Queue<ReceiptExtractionJobData>(QUEUE_NAME, {
  connection: { url: ENV.REDIS_URL },
  prefix: ENV.REDIS_PREFIX,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 20 }
  }
})

export async function closeReceiptExtractionQueue() {
  await receiptExtractionQueue.close()
}

async function notifyOwner(receipt: { owner: Types.ObjectId; fileName: string }, state: 'EXTRACTED' | 'FAILED') {
  const user = await User.findOne({ _id: receipt.owner }).lean()
  if (!user) {
    return
  }
  const lng = user.settings.language
  const subject = i18n.t(`mail.pendingReceipt.${state}.subject`, { lng })
  const paragraph = i18n.t(`mail.pendingReceipt.${state}.paragraph`, { lng, X: receipt.fileName })
  await sendPushNotification(subject, paragraph, [user._id.toString()], `${ENV.VITE_FRONTEND_URL}/pending-receipts`)
}

async function markExtractionFailed(pendingReceiptId: string) {
  const receipt = await PendingReceipt.findById(pendingReceiptId)
  if (receipt && receipt.extractionStatus === 'pending') {
    receipt.extractionStatus = 'failed'
    await receipt.save()
    await notifyOwner(receipt, 'FAILED')
  }
}

let workerInstance: Worker<ReceiptExtractionJobData> | undefined

export function startReceiptExtractionWorker(concurrency = 2) {
  if (workerInstance) {
    return workerInstance
  }

  workerInstance = new Worker<ReceiptExtractionJobData>(
    QUEUE_NAME,
    async (job) => {
      const receipt = await PendingReceipt.findById(job.data.pendingReceiptId)
      if (!receipt || receipt.extractionStatus !== 'pending') {
        return
      }
      // throws on transient errors so the queue retries the job
      const extracted = await extractReceiptData(receipt.file)
      if (extracted) {
        receipt.extracted = extracted
        receipt.extractionStatus = 'done'
      } else {
        receipt.extractionStatus = 'failed'
      }
      await receipt.save()
      logger.debug(`Receipt extraction ${receipt.extractionStatus} for ${job.data.pendingReceiptId}`)
      await notifyOwner(receipt, extracted ? 'EXTRACTED' : 'FAILED')
    },
    { connection: { url: ENV.REDIS_URL }, prefix: ENV.REDIS_PREFIX, concurrency }
  )

  workerInstance.on('failed', async (job, err) => {
    logger.warn(`Receipt extraction job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err}`)
    // only mark as failed once all retry attempts are exhausted
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      try {
        await markExtractionFailed(job.data.pendingReceiptId)
      } catch (saveErr) {
        logger.warn(`Failed to mark receipt as extraction-failed: ${saveErr}`)
      }
    }
  })

  logger.info('Receipt extraction worker started')
  return workerInstance
}
