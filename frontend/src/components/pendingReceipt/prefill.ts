import { baseCurrency, Expense, PendingReceipt } from 'abrechnung-common/types.js'
import { getById } from 'abrechnung-common/utils/scripts.js'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import API from '@/api.js'
import APP_LOADER from '@/dataLoader.js'
import { eventBus } from '@/eventBus.js'

export interface PendingReceiptPrefill {
  pendingReceiptId: string
  expense: Partial<Expense<string>>
}

/**
 * Reads the pendingReceiptId query param set by PendingReceiptsView, clears it from the URL,
 * fetches the receipt and returns a pre-filled expense to open the add-expense modal with.
 */
export async function readPendingReceiptQuery(
  route: RouteLocationNormalizedLoaded,
  router: Router
): Promise<PendingReceiptPrefill | null> {
  const pendingReceiptId = route.query.pendingReceiptId as string | undefined
  if (!pendingReceiptId) {
    return null
  }
  router.replace({ query: {} })
  const result = await API.getter<PendingReceipt<string>>('pendingReceipt', { _id: pendingReceiptId }, {}, false)
  const receipt = result.ok?.data
  if (!receipt) {
    return null
  }
  const extracted = receipt.extracted
  // CurrencySelector needs a Currency object, not the ISO code from the extraction
  const currency = getById(extracted?.currency || '', APP_LOADER.data.value?.currencies || []) || baseCurrency
  const expense = {
    description: extracted?.description || extracted?.merchant || '',
    cost: {
      amount: extracted?.amount ?? null,
      currency,
      date: extracted?.date || '',
      receipts: [{ _id: receipt.file, name: receipt.fileName, type: receipt.fileType }]
    }
  } as Partial<Expense<string>>
  return { pendingReceiptId, expense }
}

/**
 * Completes an assignment by deleting the pending receipt. The expense referencing
 * the DocumentFile is already saved, so the backend's delete hook keeps the file.
 */
export async function finishPendingReceiptAssignment(prefill: PendingReceiptPrefill) {
  await API.deleter('pendingReceipt', { _id: prefill.pendingReceiptId }, false, { success: false, error: false })
  eventBus.dispatchEvent(new CustomEvent('pendingReceipts-changed'))
}
