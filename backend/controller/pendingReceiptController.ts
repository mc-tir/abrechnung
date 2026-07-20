import { DocumentFileType, documentFileTypes, PendingReceipt as IPendingReceipt } from 'abrechnung-common/types.js'
import { Types } from 'mongoose'
import { Consumes, Delete, Get, Middlewares, Post, Queries, Query, Request, Route, Security, Tags } from 'tsoa'
import { fileHandler } from '../helper.js'
import DocumentFile from '../models/documentFile.js'
import PendingReceipt from '../models/pendingReceipt.js'
import { receiptExtractionQueue } from '../workers/receiptExtraction.js'
import { Controller, GetterQuery } from './controller.js'
import { ClientError, NotFoundError } from './error.js'
import { AuthenticatedExpressRequest } from './types.js'

@Tags('Pending Receipt')
@Route('pendingReceipt')
@Security('cookieAuth', ['user'])
@Security('httpBearer', ['user'])
export class PendingReceiptController extends Controller {
  @Get()
  public async getOwn(@Queries() query: GetterQuery<IPendingReceipt<Types.ObjectId>>, @Request() request: AuthenticatedExpressRequest) {
    return await this.getter(PendingReceipt, { query, filter: { owner: request.user._id }, sort: { createdAt: -1 } })
  }

  @Post()
  @Middlewares(fileHandler.any())
  @Consumes('multipart/form-data')
  public async create(@Request() request: AuthenticatedExpressRequest) {
    const files = request.files as Express.Multer.File[]
    if (!files?.length) {
      throw new NotFoundError('No file uploaded')
    }
    const f = files[0]
    if (!documentFileTypes.includes(f.mimetype as DocumentFileType)) {
      throw new ClientError(`Unsupported file type: '${f.mimetype}'`)
    }
    const docFile = await new DocumentFile({ owner: request.user._id, name: f.originalname, type: f.mimetype, data: f.buffer }).save()

    const receipt = await new PendingReceipt({
      owner: request.user._id,
      file: docFile._id,
      fileName: f.originalname,
      fileType: f.mimetype
    }).save()

    await receiptExtractionQueue.add('extract', { pendingReceiptId: receipt._id.toString() })
    return { message: 'alerts.successSaving', result: receipt.toObject() as IPendingReceipt<Types.ObjectId> }
  }

  /**
   * Removes a pending receipt — either dismissing it or completing an assignment.
   * The model's delete hook keeps the DocumentFile if a report references it.
   */
  @Delete()
  public async remove(@Query() _id: string, @Request() request: AuthenticatedExpressRequest) {
    return await this.deleter(PendingReceipt, {
      _id,
      async checkOldObject(oldObject) {
        return request.user._id.equals(oldObject.owner)
      }
    })
  }
}
