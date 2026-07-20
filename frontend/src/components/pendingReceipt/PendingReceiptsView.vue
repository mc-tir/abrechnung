<template>
  <div class="container py-3">
    <h2 class="mb-3">{{ t('labels.pendingReceipts') }}</h2>

    <!-- Upload zone -->
    <div
      class="upload-zone mb-4 rounded border-2 d-flex flex-column align-items-center justify-content-center gap-2 p-4"
      :class="isDragging ? 'border-primary bg-primary bg-opacity-10' : 'border-secondary'"
      style="border-style: dashed; cursor: pointer; min-height: 120px;"
      @click="fileInput?.click()"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop">
      <div v-if="uploadingCount > 0" class="d-flex align-items-center gap-2 text-primary">
        <span class="spinner-border spinner-border-sm"></span>
        <span>{{ t('labels.uploading') }} ({{ uploadingCount }})</span>
      </div>
      <template v-else>
        <i class="bi bi-cloud-arrow-up fs-1 text-secondary"></i>
        <span class="text-secondary">{{ t('labels.uploadReceipt') }}</span>
        <span class="text-secondary small">{{ t('labels.uploadReceiptHint') }}</span>
      </template>
      <input ref="fileInput" type="file" class="d-none" multiple :accept="documentFileTypes.join(',')" @change="onFileInputChange" >
    </div>

    <div v-if="loading" class="text-center py-4"><span class="spinner-border"></span></div>

    <div v-else-if="receipts.length === 0" class="text-muted">{{ t('alerts.noData.default') }}</div>

    <div v-else class="row g-3">
      <div v-for="receipt in receipts" :key="receipt._id" class="col-12 col-md-6 col-lg-4">
        <div class="card h-100">
          <div class="card-img-top bg-light d-flex align-items-center justify-content-center" style="height: 180px; overflow: hidden;">
            <img
              v-if="receipt.file"
              :src="`${BACKEND_URL}/documentFile?_id=${receipt.file}`"
              class="img-fluid"
              style="max-height: 180px; object-fit: contain;"
              alt=""
              @error="(e) => { (e.target as HTMLElement).style.display = 'none'; (e.target as HTMLElement).nextElementSibling?.setAttribute('style', '') }" >
            <i class="bi bi-file-earmark-pdf fs-1 text-muted" style="display:none"></i>
          </div>

          <div class="card-body">
            <div class="mb-2 d-flex align-items-center gap-2">
              <span
                v-if="receipt.extractionStatus === 'pending'"
                class="spinner-border spinner-border-sm text-secondary"
                role="status"></span>
              <span v-else-if="receipt.extractionStatus === 'failed'" class="badge bg-danger">{{ t('labels.extractionFailed') }}</span>
              <span v-else-if="receipt.extracted?.confidence" class="badge" :class="confidenceBadgeClass(receipt.extracted.confidence)">
                {{ t('labels.confidence.' + receipt.extracted.confidence) }}
              </span>
            </div>

            <p class="mb-1"><strong>{{ t('labels.extractedData') }}</strong></p>
            <ul class="list-unstyled small mb-2">
              <li v-if="receipt.extracted?.description">
                <i class="bi bi-card-text me-1"></i>
                {{ receipt.extracted.description }}
              </li>
              <li v-if="receipt.extracted?.date">
                <i class="bi bi-calendar me-1"></i>
                {{ receipt.extracted.date }}
              </li>
              <li v-if="receipt.extracted?.amount != null">
                <i class="bi bi-currency-exchange me-1"></i>
                {{ receipt.extracted.amount }}
                {{ receipt.extracted.currency }}
              </li>
              <li v-if="receipt.extracted?.merchant">
                <i class="bi bi-shop me-1"></i>
                {{ receipt.extracted.merchant }}
              </li>
              <li v-if="receipt.extracted?.category">
                <i class="bi bi-tag me-1"></i>
                {{ receipt.extracted.category }}
              </li>
            </ul>
          </div>

          <div class="card-footer d-flex gap-2">
            <button class="btn btn-primary btn-sm flex-grow-1" @click="openAssign(receipt)">{{ t('labels.assign') }}</button>
            <button class="btn btn-outline-secondary btn-sm" @click="dismiss(receipt)">{{ t('labels.dismiss') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Assign Modal -->
    <ModalComponent ref="assignModal" :header="t('labels.assign')" @afterClose="onAssignModalClosed">
      <div v-if="assignTarget">
        <ExpenseReportForm
          v-if="createType === 'expenseReport'"
          mode="add"
          :expenseReport="{}"
          :loading="createLoading"
          :owner="APP_DATA?.user"
          update-user-org
          @cancel="createType = null"
          @add="createReport" />
        <HealthCareCostForm
          v-else-if="createType === 'healthCareCost'"
          mode="add"
          :healthCareCost="{}"
          :loading="createLoading"
          :owner="APP_DATA?.user"
          update-user-org
          @cancel="createType = null"
          @add="createReport" />
        <TravelApplyForm
          v-else-if="createType === 'travel'"
          mode="add"
          :travel="{}"
          :loading="createLoading"
          :owner="APP_DATA?.user"
          minStartDate=""
          createNotApply
          update-user-org
          @cancel="createType = null"
          @add="createReport" />
        <template v-else>
          <div v-if="loadingReports" class="text-center py-3"><span class="spinner-border"></span></div>
          <template v-else>
            <div v-if="availableReports.length === 0" class="text-muted mb-3">{{ t('alerts.noData.default') }}</div>
            <div v-else class="list-group mb-3">
              <button
                v-for="report in availableReports"
                :key="report._id"
                type="button"
                class="list-group-item list-group-item-action d-flex align-items-center"
                @click="assignTo(report)">
                <span class="me-2 text-secondary"><i v-for="icon in APP_DATA?.displaySettings.reportTypeIcons[report.type]" :class="`bi bi-${icon} me-1`"></i></span>
                <span class="flex-grow-1 text-start">{{ report.name }}</span>
                <span class="text-secondary small ms-2">{{ t('labels.' + report.type) }}</span>
              </button>
            </div>
            <div class="d-flex flex-wrap gap-2 align-items-center">
              <button v-for="type in creatableTypes" :key="type" class="btn btn-outline-secondary btn-sm" @click="createType = type">
                <i class="bi bi-plus-lg"></i>
                <span class="ms-1">{{ t('labels.newX', { X: t('labels.' + type) }) }}</span>
              </button>
              <button class="btn btn-light btn-sm ms-auto" @click="closeAssignModal">{{ t('labels.cancel') }}</button>
            </div>
          </template>
        </template>
      </div>
    </ModalComponent>
  </div>
</template>

<script lang="ts" setup>
import { documentFileTypes, PendingReceipt, PendingReceiptTargetType, State, TravelState } from 'abrechnung-common/types.js'
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouteLocationRaw, useRoute, useRouter } from 'vue-router'
import API from '@/api.js'
import ModalComponent from '@/components/elements/ModalComponent.vue'
import ExpenseReportForm from '@/components/expenseReport/forms/ExpenseReportForm.vue'
import HealthCareCostForm from '@/components/healthCareCost/forms/HealthCareCostForm.vue'
import TravelApplyForm from '@/components/travel/forms/TravelApplyForm.vue'
import APP_LOADER from '@/dataLoader.js'
import ENV from '@/env.js'
import { eventBus } from '@/eventBus.js'
import { logger } from '@/logger.js'

interface AssignableReport {
  _id: string
  name?: string
  state: number
  type: PendingReceiptTargetType
}

// only reports the owner can currently add expenses to
const editableState: Record<PendingReceiptTargetType, number> = {
  expenseReport: State.EDITABLE_BY_OWNER,
  travel: TravelState.APPROVED,
  healthCareCost: State.EDITABLE_BY_OWNER
}

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// App-Daten laden, damit die Seite auch bei Direktaufruf (z.B. via Share-Target) angezeigt wird
await APP_LOADER.loadData()
const APP_DATA = APP_LOADER.data

const BACKEND_URL = ENV.VITE_BACKEND_URL

const receipts = ref<PendingReceipt<string>[]>([])
const loading = ref(false)

const fileInput = useTemplateRef('fileInput')
const isDragging = ref(false)
const uploadingCount = ref(0)

const assignModal = useTemplateRef('assignModal')
const assignTarget = ref<PendingReceipt<string> | null>(null)
const availableReports = ref<AssignableReport[]>([])
const loadingReports = ref(false)
const createType = ref<PendingReceiptTargetType | null>(null)
const createLoading = ref(false)

// types the user may create a new, immediately editable report for
// (travel only with 'approved:travel', otherwise the new travel would need approval first)
const creatableTypes = computed<PendingReceiptTargetType[]>(() => {
  const user = APP_DATA.value?.user
  const settings = APP_DATA.value?.settings
  if (!user || !settings) return []
  const types: PendingReceiptTargetType[] = []
  if (!settings.disableReportType.travel && user.access['appliedFor:travel'] && user.access['approved:travel']) types.push('travel')
  if (!settings.disableReportType.expenseReport && user.access['inWork:expenseReport']) types.push('expenseReport')
  if (!settings.disableReportType.healthCareCost && user.access['inWork:healthCareCost']) types.push('healthCareCost')
  return types
})

function confidenceBadgeClass(confidence: string) {
  if (confidence === 'high') return 'bg-success'
  if (confidence === 'medium') return 'bg-warning text-dark'
  return 'bg-danger'
}

async function uploadFile(file: File) {
  const fd = new FormData()
  fd.append('receipt', file)
  return await API.setter<PendingReceipt<string>>('pendingReceipt', fd)
}

async function uploadFiles(files: FileList | File[]) {
  const list = Array.from(files)
  if (!list.length) return
  uploadingCount.value += list.length
  const results = await Promise.all(list.map((f) => uploadFile(f)))
  for (const r of results) {
    if (r.ok) {
      receipts.value.unshift(r.ok)
    }
  }
  uploadingCount.value -= list.length
  if (fileInput.value) fileInput.value.value = ''
  eventBus.dispatchEvent(new CustomEvent('pendingReceipts-changed'))
  schedulePollIfNeeded()
}

function onFileInputChange(event: Event) {
  const files = (event.target as HTMLInputElement).files
  if (files) uploadFiles(files)
}

function onDrop(event: DragEvent) {
  isDragging.value = false
  const files = event.dataTransfer?.files
  if (files) uploadFiles(files)
}

let pollTimer: ReturnType<typeof setTimeout> | undefined

async function load() {
  loading.value = true
  const result = await API.getter<PendingReceipt<string>[]>('pendingReceipt')
  if (result.ok) {
    receipts.value = result.ok.data as PendingReceipt<string>[]
  }
  loading.value = false
  schedulePollIfNeeded()
}

async function pollPending() {
  const result = await API.getter<PendingReceipt<string>[]>('pendingReceipt', {}, {}, false)
  if (result.ok) {
    const fresh = result.ok.data as PendingReceipt<string>[]
    for (const updated of fresh) {
      const idx = receipts.value.findIndex((r) => r._id === updated._id)
      if (idx !== -1) receipts.value[idx] = updated
    }
  }
  schedulePollIfNeeded()
}

// push messages from the service worker trigger an instant refresh;
// the timer is only a fallback (e.g. dev setups without HTTPS have no push)
function schedulePollIfNeeded() {
  clearTimeout(pollTimer)
  if (receipts.value.some((r) => r.extractionStatus === 'pending')) {
    pollTimer = setTimeout(pollPending, 10_000)
  }
}

function onSwMessage(event: MessageEvent) {
  if (event.data?.type === 'push' && typeof event.data.url === 'string' && event.data.url.endsWith('/pending-receipts')) {
    pollPending()
  }
}
navigator.serviceWorker?.addEventListener('message', onSwMessage)

onUnmounted(() => {
  clearTimeout(pollTimer)
  navigator.serviceWorker?.removeEventListener('message', onSwMessage)
})

async function dismiss(receipt: PendingReceipt<string>) {
  const deleted = await API.deleter('pendingReceipt', { _id: receipt._id })
  if (deleted) {
    receipts.value = receipts.value.filter((r) => r._id !== receipt._id)
    eventBus.dispatchEvent(new CustomEvent('pendingReceipts-changed'))
  }
}

function openAssign(receipt: PendingReceipt<string>) {
  assignTarget.value = receipt
  createType.value = null
  availableReports.value = []
  fetchAssignableReports()
  assignModal.value?.modal?.show()
}

function closeAssignModal() {
  assignModal.value?.hideModal()
}

// all reports (of all types) the receipt can currently be assigned to
async function fetchAssignableReports() {
  loadingReports.value = true
  const types: PendingReceiptTargetType[] = (['travel', 'expenseReport', 'healthCareCost'] as const).filter(
    (type) => !APP_DATA.value?.settings.disableReportType[type]
  )
  const results = await Promise.all(types.map((type) => API.getter<AssignableReport[]>(type, {}, {}, false)))
  const reports: AssignableReport[] = []
  for (let i = 0; i < types.length; i++) {
    const data = results[i].ok?.data as AssignableReport[] | undefined
    if (data) {
      for (const report of data) {
        if (report.state === editableState[types[i]]) {
          reports.push({ ...report, type: types[i] })
        }
      }
    }
  }
  availableReports.value = reports
  loadingReports.value = false
}

// navigate only after the modal finished hiding, so the bootstrap modal
// is not disposed mid-transition when this view unmounts
let navigateAfterClose: RouteLocationRaw | null = null

function onAssignModalClosed() {
  if (navigateAfterClose) {
    const to = navigateAfterClose
    navigateAfterClose = null
    router.push(to)
  }
}

function assignTo(report: AssignableReport) {
  if (!assignTarget.value) return
  navigateAfterClose = { path: `/${report.type}/${report._id}`, query: { pendingReceiptId: assignTarget.value._id } }
  closeAssignModal()
}

// create a new report and continue the assignment on its page
async function createReport(payload: Record<string, unknown>) {
  if (!assignTarget.value || !createType.value) return
  const type = createType.value
  const endpoint = type === 'travel' ? 'travel/approved' : `${type}/inWork`
  createLoading.value = true
  const result = await API.setter<{ _id: string }>(endpoint, payload)
  createLoading.value = false
  if (result.ok) {
    navigateAfterClose = { path: `/${type}/${result.ok._id}`, query: { pendingReceiptId: assignTarget.value._id } }
    closeAssignModal()
  }
}

async function handleShareTarget() {
  try {
    const cache = await caches.open('pending-shares')
    const cached = await cache.match('/pending-share-file')
    if (!cached) return
    const blob = await cached.blob()
    const filename = cached.headers.get('X-Filename') || 'receipt'
    const file = new File([blob], filename, { type: blob.type })
    await cache.delete('/pending-share-file')
    await uploadFiles([file])
    router.replace({ query: {} })
  } catch (err) {
    logger.error('Share target upload failed:', err)
  }
}

onMounted(async () => {
  if (route.query.fromShare === '1') {
    await handleShareTarget()
  }
  await load()
})
</script>
