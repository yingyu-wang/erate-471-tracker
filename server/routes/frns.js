const express = require('express');
const { query, getClient } = require('../db');

const router = express.Router();

const FRN_STATUSES = [
  'pending', 'committed', 'denied', 'cancelled', 'partially_funded', 'under_review'
];

function validateFrn(body, isUpdate = false) {
  const errors = [];
  if (!isUpdate) {
    if (!body.application_id) errors.push('application_id is required');
    if (!body.frn_number?.trim()) errors.push('frn_number is required');
    if (!body.category || ![1, 2].includes(Number(body.category))) errors.push('category must be 1 or 2');
    if (!body.service_type?.trim()) errors.push('service_type is required');
  }
  if (body.frn_status && !FRN_STATUSES.includes(body.frn_status)) {
    errors.push(`frn_status must be one of: ${FRN_STATUSES.join(', ')}`);
  }
  return errors;
}

router.get('/meta/statuses', (_req, res) => {
  res.json({ frn_statuses: FRN_STATUSES });
});

router.get('/', async (req, res) => {
  try {
    const { application_id, status, category } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (application_id) {
      conditions.push(`f.application_id = $${idx++}`);
      params.push(application_id);
    }
    if (status) {
      conditions.push(`f.frn_status = $${idx++}`);
      params.push(status);
    }
    if (category) {
      conditions.push(`f.category = $${idx++}`);
      params.push(parseInt(category, 10));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT f.*, a.application_number, a.funding_year, a.entity_name, a.ben
       FROM frns f
       JOIN applications a ON a.id = f.application_id
       ${where}
       ORDER BY a.funding_year DESC, f.frn_number`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch FRNs' });
  }
});

router.post('/', async (req, res) => {
  const errors = validateFrn(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const appCheck = await client.query('SELECT id FROM applications WHERE id = $1', [req.body.application_id]);
    if (!appCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Application not found' });
    }

    const {
      application_id, frn_number, category, service_type, function_type,
      spin, service_provider_name, pre_discount_amount = 0, discount_percentage,
      frn_status = 'pending', service_start_date, invoicing_deadline,
      committed_amount = 0, disbursed_amount = 0,
      pia_status = 'not_started', form_486_status = 'not_filed',
      form_473_status = 'not_filed', notes
    } = req.body;

    const result = await client.query(
      `INSERT INTO frns (
        application_id, frn_number, category, service_type, function_type,
        spin, service_provider_name, pre_discount_amount, discount_percentage,
        frn_status, service_start_date, invoicing_deadline,
        committed_amount, disbursed_amount, pia_status, form_486_status, form_473_status, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [
        application_id, frn_number.trim(), category, service_type.trim(), function_type || null,
        spin || null, service_provider_name || null, pre_discount_amount, discount_percentage || null,
        frn_status, service_start_date || null, invoicing_deadline || null,
        committed_amount, disbursed_amount, pia_status, form_486_status, form_473_status, notes || null
      ]
    );

    await client.query(
      `INSERT INTO status_history (record_type, record_id, old_status, new_status, notes)
       VALUES ('frn', $1, NULL, $2, 'FRN created')`,
      [result.rows[0].id, frn_status]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'FRN number already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create FRN' });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const errors = validateFrn(req.body, true);
  if (errors.length) return res.status(400).json({ errors });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT * FROM frns WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'FRN not found' });
    }

    const old = existing.rows[0];
    const fields = [
      'frn_number', 'category', 'service_type', 'function_type',
      'spin', 'service_provider_name', 'pre_discount_amount', 'discount_percentage',
      'frn_status', 'service_start_date', 'invoicing_deadline',
      'committed_amount', 'disbursed_amount', 'pia_status', 'form_486_status', 'form_473_status', 'notes'
    ];

    const updates = [];
    const values = [];
    let idx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        values.push(req.body[field] === '' ? null : req.body[field]);
      }
    }

    if (!updates.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    const result = await client.query(
      `UPDATE frns SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (req.body.frn_status && req.body.frn_status !== old.frn_status) {
      await client.query(
        `INSERT INTO status_history (record_type, record_id, old_status, new_status, notes)
         VALUES ('frn', $1, $2, $3, $4)`,
        [req.params.id, old.frn_status, result.rows[0].frn_status, req.body.status_notes || 'FRN status updated']
      );
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'FRN number already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to update FRN' });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM frns WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'FRN not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete FRN' });
  }
});

module.exports = router;