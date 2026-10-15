import { Router } from 'express';
import { HttpError, tx } from '../db.js';
import { ROLES, requireRole } from '../auth.js';
import { audit, int, notFound, num, oneOf } from '../services/common.js';
import { cancelRequest, changeUrgency, createRequest, overrideApproval } from '../services/requests.js';
import { commitAllocation, getRun, listRuns, previewAllocation } from '../services/allocation.js';
import { assignVolunteer, cancelShipment, deliverShipment, dispatchShipment, getShipment, listShipments } from '../services/shipments.js';
import { adjustStock, listInventory, listMovements, receiveStock, setReorderLevel } from '../services/inventory.js';
import { listCampStock, listDistributions, recordDistribution } from '../services/distribution.js';
import { checkIntegrity, getAlerts, getAnalytics, getDashboard } from '../services/reports.js';
import { assertCampScope, assertWarehouseScope, forbid, idParam, optId } from './guards.js';

const { ADMIN, WAREHOUSE, CAMP, VOLUNTEER } = ROLES;

const SETTING_RANGES = {
  vulnerability_weight: [0, 5],
  aging_window_hours: [1, 720],
  aging_max_bonus: [0, 3],
  planning_horizon_days: [1, 30],
  road_detour_factor: [1, 3],
  travel_speed_kmh: [5, 120],
};

export function opsRoutes({ db, at }) {
  const r = Router();
  const list = (sql, ...p) => db.prepare(sql).all(...p).map((x) => ({ ...x }));

  // ---------------------------------------------------------------- reporting
  r.get('/dashboard', (_req, res) => res.json(getDashboard(db, at())));
  r.get('/alerts', (_req, res) => res.json(getAlerts(db, at())));
  r.get('/analytics', (_req, res) => res.json(getAnalytics(db)));
  r.get('/integrity', requireRole(ADMIN), (_req, res) => res.json(checkIntegrity(db)));

  r.get('/audit', requireRole(ADMIN), (req, res) => {
    const limit = Math.min(500, Number(req.query.limit) || 100);
    res.json(list(`
      SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.details, a.created_at AS createdAt, u.full_name AS actor
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`, limit));
  });

  // ---------------------------------------------------------------- inventory
  r.get('/inventory', (req, res) => res.json(listInventory(db, { warehouseId: optId(req.query.warehouseId, 'warehouseId'), itemId: optId(req.query.itemId, 'itemId') })));
  r.get('/inventory/movements', (req, res) => res.json(listMovements(db, {
    warehouseId: optId(req.query.warehouseId, 'warehouseId'), itemId: optId(req.query.itemId, 'itemId'), limit: Math.min(500, Number(req.query.limit) || 100),
  })));

  const stockGuard = (req) => {
    const warehouseId = int(req.body?.warehouseId, 'warehouseId', { min: 1 });
    if (![ADMIN, WAREHOUSE].includes(req.user.role)) throw forbid();
    assertWarehouseScope(req.user, warehouseId);
    return { warehouseId, itemId: int(req.body?.itemId, 'itemId', { min: 1 }) };
  };
  r.post('/inventory/receive', (req, res) => {
    const g = stockGuard(req);
    receiveStock(db, req.user, { ...g, quantity: req.body.quantity, note: req.body.note }, at());
    res.status(201).json({ ok: true });
  });
  r.post('/inventory/adjust', (req, res) => {
    const g = stockGuard(req);
    adjustStock(db, req.user, { ...g, delta: req.body.delta, reason: req.body.reason }, at());
    res.json({ ok: true });
  });
  r.post('/inventory/reorder-level', (req, res) => {
    const g = stockGuard(req);
    setReorderLevel(db, req.user, { ...g, reorderLevel: req.body.reorderLevel }, at());
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- requests
  r.get('/requests', (req, res) => {
    const where = [];
    const p = [];
    if (req.query.status) { where.push('r.status = ?'); p.push(oneOf(req.query.status, 'status', ['PENDING', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'FULFILLED', 'CANCELLED'])); }
    if (req.query.open === '1') where.push("r.status IN ('PENDING','PARTIALLY_ALLOCATED')");
    if (req.query.campId) { where.push('r.camp_id = ?'); p.push(idParam(req.query.campId, 'campId')); }
    if (req.query.urgency) { where.push('r.urgency = ?'); p.push(int(req.query.urgency, 'urgency', { min: 1, max: 4 })); }
    res.json(list(`
      SELECT r.id, r.camp_id AS campId, c.name AS campName, c.population, r.urgency, ul.label AS urgencyLabel, r.status, r.notes,
             r.needed_by AS neededBy, r.created_at AS createdAt, u.full_name AS requestedBy,
             p.lines_total AS linesTotal, p.lines_allocated AS linesAllocated, p.lines_delivered AS linesDelivered
      FROM requests r
      JOIN camps c ON c.id = r.camp_id
      JOIN urgency_levels ul ON ul.level = r.urgency
      JOIN users u ON u.id = r.requested_by
      JOIN v_request_progress p ON p.request_id = r.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.created_at DESC, r.id DESC LIMIT 400`, ...p));
  });

  r.get('/requests/:id', (req, res) => {
    const id = idParam(req.params.id);
    const head = db.prepare(`
      SELECT r.id, r.camp_id AS campId, c.name AS campName, c.population, c.vulnerable_count AS vulnerableCount, r.urgency,
             ul.label AS urgencyLabel, r.status, r.notes, r.needed_by AS neededBy, r.created_at AS createdAt, u.full_name AS requestedBy
      FROM requests r JOIN camps c ON c.id = r.camp_id JOIN urgency_levels ul ON ul.level = r.urgency JOIN users u ON u.id = r.requested_by
      WHERE r.id = ?`).get(id);
    if (!head) throw notFound('Request');
    const items = list(`
      SELECT ri.id, ri.item_id AS itemId, i.name AS itemName, i.unit, ri.quantity_requested AS requested, ri.quantity_approved AS approved,
             ri.quantity_allocated AS allocated, ri.quantity_delivered AS delivered, ri.approval_note AS approvalNote
      FROM request_items ri JOIN supply_items i ON i.id = ri.item_id WHERE ri.request_id = ? ORDER BY i.name`, id);
    const decisions = list(`
      SELECT d.request_item_id AS requestItemId, d.run_id AS runId, ar.created_at AS createdAt, d.need_qty AS need, d.allocated_qty AS allocated,
             d.priority_score AS score, d.scarce, d.explanation
      FROM allocation_decisions d JOIN allocation_runs ar ON ar.id = d.run_id
      WHERE d.request_item_id IN (SELECT id FROM request_items WHERE request_id = ?) ORDER BY d.id DESC`, id);
    const shipments = list(`
      SELECT DISTINCT s.id, s.code, s.status FROM shipments s JOIN shipment_items si ON si.shipment_id = s.id
      JOIN request_items ri ON ri.id = si.request_item_id WHERE ri.request_id = ? ORDER BY s.id`, id);
    res.json({ ...head, items, decisions, shipments });
  });

  r.post('/requests', requireRole(ADMIN, CAMP), (req, res) => {
    const campId = int(req.body?.campId, 'campId', { min: 1 });
    assertCampScope(req.user, campId);
    const id = createRequest(db, req.user, req.body, at());
    res.status(201).json({ id });
  });

  const requestCamp = (id) => {
    const row = db.prepare('SELECT camp_id AS campId FROM requests WHERE id = ?').get(id);
    if (!row) throw notFound('Request');
    return row.campId;
  };
  r.post('/requests/:id/cancel', requireRole(ADMIN, CAMP), (req, res) => {
    const id = idParam(req.params.id);
    assertCampScope(req.user, requestCamp(id));
    cancelRequest(db, req.user, id, at());
    res.json({ ok: true });
  });
  r.post('/requests/:id/urgency', requireRole(ADMIN, CAMP), (req, res) => {
    const id = idParam(req.params.id);
    assertCampScope(req.user, requestCamp(id));
    changeUrgency(db, req.user, id, req.body?.urgency, at());
    res.json({ ok: true });
  });
  r.post('/request-items/:id/approval', requireRole(ADMIN), (req, res) => {
    overrideApproval(db, req.user, idParam(req.params.id), req.body?.approved, req.body?.note, at());
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- allocation
  r.get('/allocation/settings', (_req, res) => res.json({
    settings: list('SELECT key, value, description FROM allocation_settings ORDER BY key'),
    urgencyLevels: list('SELECT level, label, weight, sla_hours AS slaHours FROM urgency_levels ORDER BY level'),
  }));

  r.put('/allocation/settings', requireRole(ADMIN), (req, res) => {
    const incoming = req.body || {};
    tx(db, () => {
      for (const [key, raw] of Object.entries(incoming)) {
        if (!SETTING_RANGES[key]) throw new HttpError(400, 'VALIDATION', `Unknown setting: ${key}`);
        const [min, max] = SETTING_RANGES[key];
        const value = num(raw, key, { min, max });
        db.prepare('UPDATE allocation_settings SET value = ? WHERE key = ?').run(value, key);
      }
      audit(db, req.user.id, 'SETTINGS_CHANGED', 'allocation_settings', null, incoming, at());
    });
    res.json({ ok: true });
  });

  r.post('/allocation/preview', requireRole(ADMIN), (req, res) => {
    res.json(previewAllocation(db, { disasterId: optId(req.body?.disasterId, 'disasterId') }, at()));
  });
  r.post('/allocation/run', requireRole(ADMIN), (req, res) => {
    const out = commitAllocation(db, req.user, { disasterId: optId(req.body?.disasterId, 'disasterId'), note: req.body?.note?.toString().slice(0, 300) || null }, at());
    res.status(201).json(out);
  });
  r.get('/allocation/runs', (_req, res) => res.json(listRuns(db)));
  r.get('/allocation/runs/:id', (req, res) => {
    const run = getRun(db, idParam(req.params.id));
    if (!run) throw notFound('Allocation run');
    res.json(run);
  });

  // ---------------------------------------------------------------- shipments
  r.get('/shipments', (req, res) => {
    const status = req.query.status ? oneOf(req.query.status, 'status', ['PLANNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']) : undefined;
    res.json(listShipments(db, {
      status, campId: optId(req.query.campId, 'campId'), warehouseId: optId(req.query.warehouseId, 'warehouseId'),
      volunteerId: req.query.mine === '1' ? req.user.id : optId(req.query.volunteerId, 'volunteerId'),
    }));
  });
  r.get('/shipments/:id', (req, res) => {
    const s = getShipment(db, idParam(req.params.id));
    if (!s) throw notFound('Shipment');
    res.json(s);
  });

  const shipmentRow = (id) => {
    const s = db.prepare('SELECT id, warehouse_id AS warehouseId, camp_id AS campId, volunteer_id AS volunteerId, status FROM shipments WHERE id = ?').get(id);
    if (!s) throw notFound('Shipment');
    return s;
  };
  const warehouseOps = (handler) => (req, res) => {
    const id = idParam(req.params.id);
    if (![ADMIN, WAREHOUSE].includes(req.user.role)) throw forbid();
    assertWarehouseScope(req.user, shipmentRow(id).warehouseId);
    handler(req, res, id);
  };

  r.post('/shipments/:id/assign', warehouseOps((req, res, id) => {
    assignVolunteer(db, req.user, id, int(req.body?.volunteerId, 'volunteerId', { min: 1 }), at());
    res.json({ ok: true });
  }));
  r.post('/shipments/:id/dispatch', warehouseOps((req, res, id) => {
    dispatchShipment(db, req.user, id, { vehicle: req.body?.vehicle, note: req.body?.note }, at());
    res.json({ ok: true });
  }));
  r.post('/shipments/:id/cancel', warehouseOps((req, res, id) => {
    cancelShipment(db, req.user, id, { note: req.body?.note }, at());
    res.json({ ok: true });
  }));

  r.post('/shipments/:id/claim', requireRole(VOLUNTEER), (req, res) => {
    const id = idParam(req.params.id);
    const s = shipmentRow(id);
    if (s.volunteerId && s.volunteerId !== req.user.id) throw new HttpError(409, 'ALREADY_ASSIGNED', 'Another volunteer already has this shipment.');
    assignVolunteer(db, req.user, id, req.user.id, at());
    res.json({ ok: true });
  });

  r.post('/shipments/:id/deliver', (req, res) => {
    const id = idParam(req.params.id);
    const s = shipmentRow(id);
    const allowed = req.user.role === ADMIN
      || (req.user.role === CAMP && req.user.campId === s.campId)
      || (req.user.role === VOLUNTEER && s.volunteerId === req.user.id);
    if (!allowed) throw forbid('Only the receiving camp, the assigned volunteer or an administrator can confirm delivery.');
    res.json(deliverShipment(db, req.user, id, { received: req.body?.received, note: req.body?.note }, at()));
  });

  // ---------------------------------------------------------------- camp stock & distribution
  r.get('/camps/:id/stock', (req, res) => res.json(listCampStock(db, idParam(req.params.id))));
  r.get('/distributions', (req, res) => res.json(listDistributions(db, { campId: optId(req.query.campId, 'campId') })));
  r.post('/distributions', requireRole(ADMIN, CAMP), (req, res) => {
    const campId = int(req.body?.campId, 'campId', { min: 1 });
    assertCampScope(req.user, campId);
    const id = recordDistribution(db, req.user, {
      campId, itemId: int(req.body?.itemId, 'itemId', { min: 1 }), quantity: req.body?.quantity,
      peopleServed: req.body?.peopleServed, note: req.body?.note,
    }, at());
    res.status(201).json({ id });
  });

  return r;
}
