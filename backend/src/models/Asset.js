import mongoose from 'mongoose';

const assetSchema = new mongoose.Schema(
  {
    scanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Scan',
      required: true,
      index: true,
    },

    assetType: {
      type: String,
      enum: [
        'domain',
        'api',
        'repository',
        'certificate',
        'software',
        'ip',
        'server',
        'webapp',
        'unknown',
      ],
      default: 'unknown',
      index: true,
    },

    status: {
      type: String,
      enum: ['new', 'false_positive', 'confirmed', 'resolved'],
      default: 'new',
    },

    name: { type: String, default: '' },
    target: { type: String, default: '' },
    hostname: { type: String, default: '' },
    domain: { type: String, default: '' },
    commonName: { type: String, default: '' },

    softwareName: { type: String, default: '' },
    softwareVersion: { type: String, default: '' },
    product: { type: String, default: '' },

    ipAddress: { type: String, default: '' },
    subnet: { type: String, default: '' },
    port: { type: String, default: '' },
    url: { type: String, default: '' },
    apiPath: { type: String, default: '' },
    isApi: { type: Boolean, default: false },

    owner: { type: String, default: '' },
    registrar: { type: String, default: '' },
    registrationDate: { type: Date, default: null },

    certificateAuthority: { type: String, default: '' },
    issuer: { type: String, default: '' },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    expiresAt: { type: Date, default: null },

    tlsVersion: { type: String, default: '' },
    protocol: { type: String, default: '' },
    cipherSuite: { type: String, default: '' },
    cipher: { type: String, default: '' },
    keyExchange: { type: String, default: '' },
    signature: { type: String, default: '' },
    keyLength: { type: String, default: '' },

    appName: { type: String, default: '' },

    severity: {
      type: String,
      enum: ['critical', 'high', 'moderate', 'low', ''],
      default: '',
    },

    riskSeverity: {
      type: String,
      enum: ['critical', 'high', 'moderate', 'low', ''],
      default: '',
    },

    summary: { type: String, default: '' },

    quantumSafe: { type: Boolean, default: false },

    pqc: {
      grade: { type: String, default: '' },
      supportStatus: { type: String, default: '' },
      migrationPriority: { type: String, default: '' },
    },

    pqcGrade: { type: String, default: '' },
    pqcSupport: { type: String, default: '' },

    findings: [{ type: String }],

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export const Asset = mongoose.model('Asset', assetSchema);