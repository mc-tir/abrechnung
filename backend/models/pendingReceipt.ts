import { documentFileTypes, PendingReceipt as IPendingReceipt } from 'abrechnung-common/types.js'
import { model, Schema, Types } from 'mongoose'

const schema = new Schema<IPendingReceipt<Types.ObjectId>>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    file: { type: Schema.Types.ObjectId, ref: 'DocumentFile', required: true },
    fileName: { type: String, required: true },
    fileType: { type: String, enum: documentFileTypes, required: true },
    extractionStatus: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending', required: true },
    extracted: {
      date: String,
      amount: Number,
      currency: String,
      merchant: String,
      description: String,
      category: String,
      confidence: { type: String, enum: ['high', 'medium', 'low'] }
    }
  },
  { timestamps: true }
)

schema.index({ owner: 1 })

schema.pre('deleteOne', { document: true, query: false }, async function (this: IPendingReceipt<Types.ObjectId>) {
  // an assigned receipt's DocumentFile belongs to the report's expense —
  // only delete the file if no report references it
  const references = await Promise.all([
    model('ExpenseReport').exists({ 'expenses.cost.receipts': this.file }),
    model('Travel').exists({ $or: [{ 'stages.cost.receipts': this.file }, { 'expenses.cost.receipts': this.file }] }),
    model('HealthCareCost').exists({ 'expenses.cost.receipts': this.file })
  ])
  if (references.every((ref) => ref === null)) {
    await model('DocumentFile').deleteOne({ _id: this.file })
  }
})

export default model<IPendingReceipt<Types.ObjectId>>('PendingReceipt', schema)
