import mongoose from 'mongoose';

const reportScheduleSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    reportType: {
      type: String,
      required: true,
    },
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly'],
      required: true,
    },
    assetFilter: {
      type: String,
      default: 'all',
    },
    includedSections: {
      type: [String],
      default: [],
    },
    delivery: {
      email: {
        type: [String],
        default: [],
      },
      savePath: {
        type: String,
        default: '',
      },
      format: {
        type: String,
        enum: ['pdf', 'json', 'csv'],
        default: 'pdf',
      },
      downloadableLink: {
        type: Boolean,
        default: false,
      },
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
    },
    nextRunAt: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model('ReportSchedule', reportScheduleSchema);