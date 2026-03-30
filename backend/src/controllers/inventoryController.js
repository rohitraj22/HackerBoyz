import {Asset} from '../models/Asset.js';

function buildSearchFilter(q) {
  if (!q?.trim()) return {};

  const regex = new RegExp(q.trim(), 'i');

  return {
    $or: [
      { name: regex },
      { hostname: regex },
      { domain: regex },
      { commonName: regex },
      { softwareName: regex },
      { ipAddress: regex },
      { subnet: regex },
      { certificateAuthority: regex },
      { owner: regex },
      { url: regex },
    ],
  };
}

export async function getInventorySummary(req, res, next) {
  try {
    const assets = await Asset.find({}, 'assetType type status').lean();

    const summary = {
      domain: { count: 0 },
      certificate: { count: 0 },
      ip: { count: 0 },
      software: { count: 0 },
    };

    for (const asset of assets) {
      const type = String(asset.assetType || asset.type || '').toLowerCase();

      if (type.includes('domain')) summary.domain.count += 1;
      else if (type.includes('cert')) summary.certificate.count += 1;
      else if (type.includes('ip') || type.includes('subnet')) summary.ip.count += 1;
      else if (type.includes('software')) summary.software.count += 1;
    }

    res.json(summary);
  } catch (error) {
    next(error);
  }
}

export async function listInventoryAssets(req, res, next) {
  try {
    const {
      type,
      status,
      q,
      page = 1,
      limit = 25,
    } = req.query;

    const filter = {
      ...buildSearchFilter(q),
    };

    if (type) {
      filter.assetType = type;
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    const assets = await Asset.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    const total = await Asset.countDocuments(filter);

    res.json({
      assets,
      page: Number(page),
      limit: Number(limit),
      total,
    });
  } catch (error) {
    next(error);
  }
}

export async function getInventoryAssetById(req, res, next) {
  try {
    const asset = await Asset.findById(req.params.id).lean();

    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }

    res.json(asset);
  } catch (error) {
    next(error);
  }
}

export async function updateInventoryAssetStatus(req, res, next) {
  try {
    const { status } = req.body;

    const allowed = ['new', 'false_positive', 'confirmed', 'resolved'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const asset = await Asset.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).lean();

    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }

    res.json({
      message: 'Asset status updated',
      asset,
    });
  } catch (error) {
    next(error);
  }
}