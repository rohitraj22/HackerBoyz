import mongoose from 'mongoose';

const cbomSnapshotSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      default: null,
    },
    scanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Scan',
      index: true,
      default: null,
    },
    totals: {
      applications: { type: Number, default: 0 },
      certificates: { type: Number, default: 0 },
      weakCryptography: { type: Number, default: 0 },
      certificateIssues: { type: Number, default: 0 },
    },
    keyLengthDistribution: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    cipherUsage: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    authorities: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    protocolDistribution: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    rows: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    aiSummary: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

export default mongoose.model('CBOMSnapshot', cbomSnapshotSchema);