const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/stats', async (_req, res) => {
  try {
    const [apps, frns, byStatus, byYear, recentHistory] = await Promise.all([
      query('SELECT COUNT(*)::int AS total FROM applications'),
      query('SELECT COUNT(*)::int AS total FROM frns'),
      query(`
        SELECT application_status, COUNT(*)::int AS count
        FROM applications
        GROUP BY application_status
        ORDER BY count DESC
      `),
      query(`
        SELECT funding_year, COUNT(*)::int AS applications,
               COALESCE(SUM(f.pre_discount_amount), 0)::float AS total_requested,
               COALESCE(SUM(f.committed_amount), 0)::float AS total_committed
        FROM applications a
        LEFT JOIN frns f ON f.application_id = a.id
        GROUP BY funding_year
        ORDER BY funding_year DESC
      `),
      query(`
        SELECT sh.*,
               CASE
                 WHEN sh.record_type = 'application' THEN a.application_number
                 WHEN sh.record_type = 'frn' THEN fr.frn_number
               END AS record_label
        FROM status_history sh
        LEFT JOIN applications a ON sh.record_type = 'application' AND sh.record_id = a.id
        LEFT JOIN frns fr ON sh.record_type = 'frn' AND sh.record_id = fr.id
        ORDER BY sh.changed_at DESC
        LIMIT 10
      `),
    ]);

    const frnStatusBreakdown = await query(`
      SELECT frn_status, COUNT(*)::int AS count
      FROM frns
      GROUP BY frn_status
      ORDER BY count DESC
    `);

    res.json({
      totals: {
        applications: apps.rows[0].total,
        frns: frns.rows[0].total,
      },
      applications_by_status: byStatus.rows,
      frns_by_status: frnStatusBreakdown.rows,
      by_funding_year: byYear.rows,
      recent_activity: recentHistory.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

module.exports = router;