import mongoose from 'mongoose';

const assetRelationSchema = new mongoose.Schema(
  {
    scanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Scan',
      index: true,
    },
    sourceAssetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Asset',
      required: true,
      index: true,
    },
    targetAssetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Asset',
      required: true,
      index: true,
    },
    relationType: {
      type: String,
      enum: ['resolves_to', 'uses_cert', 'hosts_service', 'points_to', 'belongs_to', 'depends_on'],
      required: true,
    },
    confidence: {
      type: Number,
      default: 0.7,
      min: 0,
      max: 1,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.model('AssetRelation', assetRelationSchema);