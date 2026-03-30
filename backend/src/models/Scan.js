import mongoose from 'mongoose';

const scanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    name: {
      type: String,
      trim: true,
      default: '',
    },

    target: {
      type: String,
      trim: true,
      default: '',
    },

    domain: {
      type: String,
      trim: true,
      default: '',
    },

    repoPath: {
      type: String,
      trim: true,
      default: '',
    },

    repoUrl: {
      type: String,
      trim: true,
      default: '',
    },

    apiEndpoint: {
      type: String,
      trim: true,
      default: '',
    },

    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed'],
      default: 'completed',
      index: true,
    },

    summary: {
      type: String,
      default: '',
    },

    overallRiskScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    riskLevel: {
      type: String,
      default: 'Low',
    },

    findings: [
      {
        type: String,
      },
    ],

    warnings: [
      {
        type: String,
      },
    ],

    cbom: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    report: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    scorecard: {
      normalizedScore: {
        type: Number,
        default: 0,
      },
      label: {
        type: String,
        default: '',
      },
      factors: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
      },
      urlScores: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
      },
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export const Scan = mongoose.model('Scan', scanSchema);