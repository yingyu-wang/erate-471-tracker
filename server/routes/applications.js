const express = require('express');
const { query, getClient } = require('../db');
const { searchUsacApplications, refreshApplicationFromUsac } = require('../lib/usac-live-search');

const router = express.Router();

const APPLICATION_STATUSES = [
  'draft', 'certified', 'under_review', 'fcdl_issued', 'denied', 'cancelled', 'partially_funded'
];

function validateApplication(body, isUpdate = false) {
  const errors = [];
  if (!isUpdate || body.application_number !== undefined) {
    if (!body.application_number?.trim()) errors.push('application_number is required');
  }
  if (!isUpdate || body.funding_year !== undefined) {
    if (!body.funding_year || body.funding_year < 1997) errors.push('valid funding_year is required');
  }
  if (!isUpdate || body.ben !== undefined) {
    if (!body.ben?.trim()) errors.push('ben is required');
  }
  if (!isUpdate || body.entity_name !== undefined) {
    if (!body.entity_name?.trim()) errors.push('entity_name is required');
  }
  if (body.application_status && !APPLICATION_STATUSES.includes(body.application_status)) {
    errors.push(`application_status must be one of: ${APPLICATION_STATUSES.join(', ')}`);
  }
  return errors;
}

router.get('/', async (req, res) => {
  try {
    const { funding_year, status, ben, search } = req.query;

    if (search?.trim()) {
      try {
        const live = await searchUsacApplications({
          search: search.trim(),
          fundingYear: funding_year || null,
          status: status || null,
        });
        return res.json(live);
      } catch (err) {
        if (err.status === 400) {
          return res.status(400).json({ error: err.message });
        }
        console.error('USAC live search failed, falling back to local DB:', err.message);
      }
    }

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (funding_year) {
      conditions.push(`a.funding_year = $${paramIndex++}`);
      params.push(parseInt(funding_year, 10));
    }
    if (status) {
      conditions.push(`a.application_status = $${paramIndex++}`);
      params.push(status);
    }
    if (ben) {
      conditions.push(`a.ben = $${paramIndex++}`);
      params.push(ben);
    }
    if (search) {
      conditions.push(`(
        a.entity_name ILIKE $${paramIndex} OR
        a.application_number ILIKE $${paramIndex} OR
        a.ben ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT a.*,
              COUNT(f.id)::int AS frn_count,
              COALESCE(SUM(f.pre_discount_amount), 0)::float AS total_requested,
              COALESCE(SUM(f.committed_amount), 0)::float AS total_committed
       FROM applications a
       LEFT JOIN frns f ON f.application_id = a.id
       ${where}
       GROUP BY a.id
       ORDER BY a.funding_year DESC, a.updated_at DESC`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

router.get('/meta/statuses', (_req, res) => {
  res.json({ application_statuses: APPLICATION_STATUSES });
});

router.get('/:id', async (req, res) => {
  try {
    const appResult = await query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (!appResult.rows.length) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const app = appResult.rows[0];

    if (req.query.live === '1') {
      try {
        await refreshApplicationFromUsac(app.application_number, app.funding_year);
      } catch (err) {
        console.error('USAC live refresh failed:', err.message);
      }
    }

    const refreshedApp = req.query.live === '1'
      ? await query('SELECT * FROM applications WHERE id = $1', [req.params.id])
      : appResult;

    const frns = await query(
      'SELECT * FROM frns WHERE application_id = $1 ORDER BY category, frn_number',
      [req.params.id]
    );

    const history = await query(
      `SELECT * FROM status_history
       WHERE (record_type = 'application' AND record_id = $1)
          OR (record_type = 'frn' AND record_id IN (SELECT id FROM frns WHERE application_id = $1))
       ORDER BY changed_at DESC`,
      [req.params.id]
    );

    res.json({
      ...refreshedApp.rows[0],
      frns: frns.rows,
      status_history: history.rows,
      ...(req.query.live === '1' ? { source: 'usac_live', refreshed_at: new Date().toISOString() } : {}),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch application' });
  }
});

router.post('/', async (req, res) => {
  const errors = validateApplication(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const {
      application_number, funding_year, ben, entity_name, entity_type = 'School District',
      application_status = 'draft', certified_date, fcdl_date,
      contact_name, contact_email, contact_phone, notes
    } = req.body;

    const result = await client.query(
      `INSERT INTO applications (
        application_number, funding_year, ben, entity_name, entity_type,
        application_status, certified_date, fcdl_date,
        contact_name, contact_email, contact_phone, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        application_number.trim(), funding_year, ben.trim(), entity_name.trim(), entity_type,
        application_status, certified_date || null, fcdl_date || null,
        contact_name || null, contact_email || null, contact_phone || null, notes || null
      ]
    );

    await client.query(
      `INSERT INTO status_history (record_type, record_id, old_status, new_status, notes)
       VALUES ('application', $1, NULL, $2, 'Application created')`,
      [result.rows[0].id, application_status]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Application number already exists for this funding year' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create application' });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const errors = validateApplication(req.body, true);
  if (errors.length) return res.status(400).json({ errors });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Application not found' });
    }

    const old = existing.rows[0];
    const fields = [
      'application_number', 'funding_year', 'ben', 'entity_name', 'entity_type',
      'application_status', 'certified_date', 'fcdl_date',
      'contact_name', 'contact_email', 'contact_phone', 'notes'
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
      `UPDATE applications SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    const updated = result.rows[0];
    if (req.body.application_status && req.body.application_status !== old.application_status) {
      await client.query(
        `INSERT INTO status_history (record_type, record_id, old_status, new_status, notes)
         VALUES ('application', $1, $2, $3, $4)`,
        [req.params.id, old.application_status, updated.application_status, req.body.status_notes || 'Status updated']
      );
    }

    await client.query('COMMIT');
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Application number already exists for this funding year' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to update application' });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM applications WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Application not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete application' });
  }
});

module.exports = router;