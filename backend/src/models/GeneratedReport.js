import mongoose from 'mongoose';

const generatedReportSchema = new mongoose.Schema(
  {
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    scanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Scan',
      index: true,
    },
    reportType: {
      type: String,
      required: true,
    },
    format: {
      type: String,
      enum: ['pdf', 'json', 'csv'],
      default: 'pdf',
    },
    includedSections: {
      type: [String],
      default: [],
    },
    storagePath: {
      type: String,
      default: '',
    },
    deliveryStatus: {
      type: String,
      default: 'generated',
    },
    aiExecutiveSummary: {
      type: String,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.model('GeneratedReport', generatedReportSchema);