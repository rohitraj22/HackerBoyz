import mongoose from 'mongoose';

const recommendationSchema = new mongoose.Schema(
  {
    scanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Scan',
      required: true,
      index: true
    },
    generatedBy: { type: String, default: 'gemini' },
    executiveSummary: { type: String, default: '' },
    technicalRecommendations: [{ type: String }],
    migrationPlan: [{ type: String }],
    priorityActions: [{ type: String }],
    rawModelOutput: { type: Object, default: {} }
  },
  { timestamps: true }
);

export const Recommendation = mongoose.model('Recommendation', recommendationSchema);
