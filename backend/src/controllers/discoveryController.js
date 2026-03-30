import { Asset } from '../models/Asset.js';
import { Scan } from '../models/Scan.js';
import AssetRelation from '../models/AssetRelation.js';
import { runDiscoveryForTarget } from '../services/discovery/discoveryRunService.js';

function safeHostname(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '')
      .toLowerCase();
  }
}

function buildGraphTargets(scan) {
  const targets = new Set();
  const domain = String(scan?.domain || '').trim().toLowerCase();
  const target = String(scan?.target || '').trim().toLowerCase();
  const apiHost = safeHostname(scan?.apiEndpoint);

  if (domain) targets.add(domain);
  if (target) targets.add(target);
  if (apiHost) targets.add(apiHost);

  return [...targets];
}

function buildDiscoverySearch(query) {
  if (!query?.trim()) return {};

  const regex = new RegExp(query.trim(), 'i');

  return {
    $or: [
      { name: regex },
      { hostname: regex },
      { domain: regex },
      { commonName: regex },
      { softwareName: regex },
      { ipAddress: regex },
      { subnet: regex },
      { url: regex },
      { owner: regex },
    ],
  };
}

function inferEdgesFromAssets(assets = []) {
  if (!Array.isArray(assets) || assets.length < 2) return [];

  const byType = {
    domain: [],
    api: [],
    certificate: [],
    ip: [],
  };

  for (const asset of assets) {
    const key = String(asset.assetType || asset.type || '').toLowerCase();
    if (byType[key]) {
      byType[key].push(asset);
      continue;
    }

    if (['server'].includes(key)) byType.ip.push(asset);
    else if (['webapp', 'software'].includes(key)) byType.api.push(asset);
    else if (key.includes('cert')) byType.certificate.push(asset);
    else if (key.includes('domain')) byType.domain.push(asset);
  }

  const inferred = [];
  const domainAnchor = byType.domain[0] || assets[0];
  const connectedIds = new Set([String(domainAnchor._id)]);

  const addInferredEdge = (sourceId, targetId, type, confidence = 0.5) => {
    const source = String(sourceId || '');
    const target = String(targetId || '');
    if (!source || !target || source === target) return;

    const duplicate = inferred.some(
      (edge) =>
        String(edge.source) === source &&
        String(edge.target) === target &&
        String(edge.type) === String(type)
    );
    if (duplicate) return;

    inferred.push({
      id: `inferred-${source}-${target}-${type}`,
      source,
      target,
      type,
      confidence,
    });
    connectedIds.add(source);
    connectedIds.add(target);
  };

  for (const api of byType.api) {
    addInferredEdge(domainAnchor._id, api._id, 'hosts_service', 0.55);
  }

  for (const cert of byType.certificate) {
    addInferredEdge(domainAnchor._id, cert._id, 'uses_cert', 0.55);
  }

  for (const ip of byType.ip) {
    addInferredEdge(domainAnchor._id, ip._id, 'resolves_to', 0.5);
  }

  // Connect same-host assets to reduce disconnected nodes in sparse scan outputs.
  const anchorHost = safeHostname(
    domainAnchor.hostname ||
      domainAnchor.domain ||
      domainAnchor.target ||
      domainAnchor.url ||
      domainAnchor.name
  );

  for (const item of assets) {
    const itemId = String(item._id);
    if (!itemId || connectedIds.has(itemId)) continue;

    const itemHost = safeHostname(
      item.hostname || item.domain || item.target || item.url || item.name
    );

    if (anchorHost && itemHost && anchorHost === itemHost) {
      addInferredEdge(domainAnchor._id, item._id, 'depends_on', 0.5);
    }
  }

  // Final fallback: ensure remaining assets are represented as connected graph nodes.
  for (const item of assets) {
    const itemId = String(item._id);
    if (!itemId || connectedIds.has(itemId)) continue;
    addInferredEdge(domainAnchor._id, item._id, 'depends_on', 0.4);
  }

  if (!inferred.length) {
    const anchor = assets[0];
    for (let i = 1; i < assets.length; i += 1) {
      addInferredEdge(anchor._id, assets[i]._id, 'depends_on', 0.45);
    }
  }

  return inferred;
}

function splitSignalList(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function enrichSparseGraphFromAssetSignals(nodes = [], edges = [], assets = []) {
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(assets)) {
    return { nodes, edges };
  }

  if (nodes.length !== 1 || edges.length !== 0 || assets.length !== 1) {
    return { nodes, edges };
  }

  const asset = assets[0] || {};
  const rootNode = nodes[0];
  const extraNodes = [];
  const extraEdges = [];

  const apiHost = safeHostname(asset.target || asset.url || asset.domain || asset.hostname);
  if (apiHost && apiHost !== String(rootNode.label || '').toLowerCase()) {
    const hostId = `virtual-host-${asset._id}`;
    extraNodes.push({
      id: hostId,
      label: apiHost,
      type: 'domain',
      severity: rootNode.severity || 'low',
    });
    extraEdges.push({
      id: `virtual-edge-${rootNode.id}-${hostId}`,
      source: rootNode.id,
      target: hostId,
      type: 'points_to',
      confidence: 0.6,
    });
  }

  const issuer = String(asset.issuer || asset.certificateAuthority || '').trim();
  if (issuer) {
    const issuerId = `virtual-issuer-${asset._id}`;
    extraNodes.push({
      id: issuerId,
      label: issuer,
      type: 'certificate',
      severity: rootNode.severity || 'low',
    });
    extraEdges.push({
      id: `virtual-edge-${rootNode.id}-${issuerId}`,
      source: rootNode.id,
      target: issuerId,
      type: 'uses_cert',
      confidence: 0.65,
    });
  }

  const keyExchange = String(asset.keyExchange || asset.metadata?.key_exchange || '').trim();
  if (keyExchange) {
    const keyId = `virtual-kx-${asset._id}`;
    extraNodes.push({
      id: keyId,
      label: keyExchange,
      type: 'crypto',
      severity: rootNode.severity || 'low',
    });
    extraEdges.push({
      id: `virtual-edge-${rootNode.id}-${keyId}`,
      source: rootNode.id,
      target: keyId,
      type: 'depends_on',
      confidence: 0.55,
    });
  }

  const ciphers = splitSignalList(asset.cipher || asset.cipherSuite || asset.metadata?.cipher || '');
  ciphers.slice(0, 4).forEach((cipherValue, index) => {
    const cipherId = `virtual-cipher-${asset._id}-${index}`;
    extraNodes.push({
      id: cipherId,
      label: cipherValue,
      type: 'crypto',
      severity: rootNode.severity || 'low',
    });
    extraEdges.push({
      id: `virtual-edge-${rootNode.id}-${cipherId}`,
      source: rootNode.id,
      target: cipherId,
      type: 'depends_on',
      confidence: 0.5,
    });
  });

  if (!extraNodes.length) {
    return { nodes, edges };
  }

  return {
    nodes: [...nodes, ...extraNodes],
    edges: [...edges, ...extraEdges],
  };
}

export async function runDiscovery(req, res, next) {
  try {
    const { targetType, target } = req.body;

    console.log('\n========== RUN DISCOVERY START ==========');
    console.log('[runDiscovery] body:', req.body);

    if (!targetType || !target) {
      return res.status(400).json({
        message: 'targetType and target are required',
      });
    }

    const result = await runDiscoveryForTarget({
      targetType,
      target,
      userId: req.user?._id || req.user?.id || null,
    });

    console.log('[runDiscovery] scan id:', result.scan?._id || null);
    console.log(
      '[runDiscovery] discovered assets:',
      result.discoveredAssets?.length || 0
    );
    console.log(
      '[runDiscovery] discovered relations:',
      result.discoveredRelations?.length || 0
    );
    console.log('========== RUN DISCOVERY END ==========\n');

    res.status(200).json(result);
  } catch (error) {
    console.error('[runDiscovery] ERROR:', error);
    next(error);
  }
}

export async function getDiscoveryGraph(req, res, next) {
  try {
    console.log('\n========== GET DISCOVERY GRAPH START ==========');
    console.log('[getDiscoveryGraph] query params:', req.query);

    const scanIdFromQuery = req.query.scanId;
    const userId = req.user?._id || req.user?.id || null;
    let scan = null;

    if (scanIdFromQuery && scanIdFromQuery !== 'latest') {
      console.log('[getDiscoveryGraph] Looking up scan by id:', scanIdFromQuery);
      scan = await Scan.findOne({ _id: scanIdFromQuery, userId }).lean();

      if (!scan) {
        console.log('[getDiscoveryGraph] Scan not found for user, returning empty graph');
        return res.json({
          scanId: null,
          nodes: [],
          edges: [],
          highlights: [],
        });
      }
    } else {
      console.log('[getDiscoveryGraph] Looking up latest scan');
      scan = await Scan.findOne({ userId }).sort({ createdAt: -1 }).lean();
    }

    console.log('[getDiscoveryGraph] resolved scan:', scan?._id || null);

    let graphScan = scan;
    let assetFilter = graphScan?._id ? { scanId: graphScan._id } : {};
    let relationFilter = graphScan?._id ? { scanId: graphScan._id } : {};

    console.log('[getDiscoveryGraph] assetFilter:', assetFilter);
    console.log('[getDiscoveryGraph] relationFilter:', relationFilter);

    let assets = await Asset.find(assetFilter).limit(100).lean();
    let relations = await AssetRelation.find(relationFilter).limit(200).lean();

    // If the direct scan has a sparse graph, try a discovery scan for the same target.
    if (graphScan?._id && assets.length <= 1 && relations.length === 0) {
      const graphTargets = buildGraphTargets(graphScan);
      console.log('[getDiscoveryGraph] sparse graph detected, trying target-matched discovery scan', graphTargets);

      let discoveryScan = null;

      if (graphTargets.length) {
        discoveryScan = await Scan.findOne({
          userId,
          'metadata.source': 'manual_discovery',
          target: { $in: graphTargets },
        })
          .sort({ createdAt: -1 })
          .lean();
      }

      if (discoveryScan?._id) {
        console.log('[getDiscoveryGraph] using discovery scan fallback:', discoveryScan._id);
        graphScan = discoveryScan;
        assetFilter = { scanId: graphScan._id };
        relationFilter = { scanId: graphScan._id };
        assets = await Asset.find(assetFilter).limit(100).lean();
        relations = await AssetRelation.find(relationFilter).limit(200).lean();
      }
    }

    console.log('[getDiscoveryGraph] assets fetched:', assets.length);
    console.log('[getDiscoveryGraph] relations fetched:', relations.length);

    const nodes = assets.map((asset) => ({
      id: String(asset._id),
      label:
        asset.name ||
        asset.target ||
        asset.url ||
        asset.hostname ||
        asset.domain ||
        asset.ipAddress ||
        asset.commonName ||
        'Asset',
      type: asset.assetType || asset.type || 'unknown',
      severity: asset.severity || asset.riskSeverity || 'low',
    }));

    const storedEdges = relations.map((rel) => ({
      id: String(rel._id),
      source: String(rel.sourceAssetId),
      target: String(rel.targetAssetId),
      type: rel.relationType,
      confidence: rel.confidence,
    }));

    let edges = storedEdges.length ? storedEdges : inferEdgesFromAssets(assets);

    // If stored relations are sparse, supplement with inferred edges for disconnected nodes.
    if (storedEdges.length && nodes.length > 1) {
      const connectedNodeIds = new Set();
      edges.forEach((edge) => {
        connectedNodeIds.add(String(edge.source));
        connectedNodeIds.add(String(edge.target));
      });

      const orphanNodeIds = nodes
        .map((node) => String(node.id))
        .filter((nodeId) => !connectedNodeIds.has(nodeId));

      if (orphanNodeIds.length) {
        const inferred = inferEdgesFromAssets(assets);
        const extraEdges = inferred.filter(
          (edge) =>
            orphanNodeIds.includes(String(edge.source)) ||
            orphanNodeIds.includes(String(edge.target))
        );

        if (extraEdges.length) {
          const existing = new Set(
            edges.map((edge) => `${edge.source}|${edge.target}|${edge.type}`)
          );

          extraEdges.forEach((edge) => {
            const key = `${edge.source}|${edge.target}|${edge.type}`;
            if (!existing.has(key)) {
              edges.push(edge);
              existing.add(key);
            }
          });
        }
      }
    }

    let finalNodes = nodes;

    if (edges.length === 0 && nodes.length === 1) {
      const enriched = enrichSparseGraphFromAssetSignals(nodes, edges, assets);
      finalNodes = enriched.nodes;
      edges = enriched.edges;
    }

    const highlights = assets
      .filter((asset) =>
        ['critical', 'high'].includes(
          String(asset.severity || asset.riskSeverity || '').toLowerCase()
        )
      )
      .slice(0, 10)
      .map((asset) => ({
        assetId: asset._id,
        title:
          asset.name ||
          asset.hostname ||
          asset.domain ||
          'Highlighted Asset',
        description:
          asset.summary || 'High-priority asset discovered in latest scan.',
        severity: asset.severity || asset.riskSeverity || 'high',
      }));

    console.log('[getDiscoveryGraph] nodes built:', finalNodes.length);
    console.log('[getDiscoveryGraph] edges built:', edges.length);
    console.log('[getDiscoveryGraph] highlights built:', highlights.length);
    console.log('========== GET DISCOVERY GRAPH END ==========\n');

    res.json({
      scanId: graphScan?._id || null,
      nodes: finalNodes,
      edges,
      highlights,
    });
  } catch (error) {
    console.error('[getDiscoveryGraph] ERROR:', error);
    next(error);
  }
}

export async function searchDiscovery(req, res, next) {
  try {
    console.log('\n========== SEARCH DISCOVERY START ==========');
    console.log('[searchDiscovery] req.body:', req.body);

    const { query, startDate, endDate } = req.body;

    console.log('[searchDiscovery] query:', query);
    console.log('[searchDiscovery] startDate:', startDate);
    console.log('[searchDiscovery] endDate:', endDate);

    const filter = {
      ...buildDiscoverySearch(query),
    };

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    console.log(
      '[searchDiscovery] built Mongo filter:',
      JSON.stringify(
        filter,
        (key, value) => (value instanceof RegExp ? value.toString() : value),
        2
      )
    );

    const totalAssets = await Asset.countDocuments({});
    console.log('[searchDiscovery] total assets in DB:', totalAssets);

    const matchingCount = await Asset.countDocuments(filter);
    console.log('[searchDiscovery] matching assets count:', matchingCount);

    const results = await Asset.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    console.log('[searchDiscovery] fetched results length:', results.length);

    if (results.length > 0) {
      console.log(
        '[searchDiscovery] first 5 results preview:',
        results.slice(0, 5).map((item) => ({
          id: item._id,
          assetType: item.assetType || item.type,
          name: item.name,
          hostname: item.hostname,
          domain: item.domain,
          ipAddress: item.ipAddress,
          url: item.url,
          status: item.status,
          createdAt: item.createdAt,
        }))
      );
    } else {
      console.log('[searchDiscovery] No matching assets found');
    }

    console.log('========== SEARCH DISCOVERY END ==========\n');

    res.json({ results });
  } catch (error) {
    console.error('[searchDiscovery] ERROR:', error);
    next(error);
  }
}

export async function getRelatedDiscoveryAssets(req, res, next) {
  try {
    console.log('\n========== GET RELATED DISCOVERY ASSETS START ==========');
    console.log('[getRelatedDiscoveryAssets] asset id:', req.params.id);

    const { id } = req.params;

    const relations = await AssetRelation.find({
      $or: [{ sourceAssetId: id }, { targetAssetId: id }],
    }).lean();

    console.log('[getRelatedDiscoveryAssets] relations found:', relations.length);

    const relatedIds = new Set();

    for (const relation of relations) {
      relatedIds.add(String(relation.sourceAssetId));
      relatedIds.add(String(relation.targetAssetId));
    }

    relatedIds.delete(String(id));

    console.log('[getRelatedDiscoveryAssets] related asset ids:', [...relatedIds]);

    const assets = await Asset.find({
      _id: { $in: [...relatedIds] },
    }).lean();

    console.log('[getRelatedDiscoveryAssets] related assets found:', assets.length);
    console.log('========== GET RELATED DISCOVERY ASSETS END ==========\n');

    res.json({
      relations,
      assets,
    });
  } catch (error) {
    console.error('[getRelatedDiscoveryAssets] ERROR:', error);
    next(error);
  }
}