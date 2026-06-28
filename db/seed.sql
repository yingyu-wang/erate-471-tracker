-- Sample E-Rate Form 471 data for demonstration

INSERT INTO applications (
    application_number, funding_year, ben, entity_name, entity_type,
    application_status, certified_date, fcdl_date,
    contact_name, contact_email, contact_phone, notes
) VALUES
(
    '251025476', 2025, '16012345', 'Springfield School District', 'School District',
    'under_review', '2025-03-15', NULL,
    'Jane Martinez', 'jmartinez@springfield.k12.us', '555-0101',
    'Submitted during FY2025 filing window. Awaiting PIA review.'
),
(
    '241025891', 2024, '16012345', 'Springfield School District', 'School District',
    'fcdl_issued', '2024-03-20', '2024-07-12',
    'Jane Martinez', 'jmartinez@springfield.k12.us', '555-0101',
    'FCDL received July 2024. All Category 1 FRNs committed.'
),
(
    '251026102', 2025, '16098765', 'Riverside Public Library', 'Library',
    'certified', '2025-03-28', NULL,
    'Robert Chen', 'rchen@riversidelibrary.org', '555-0202',
    'Certified and awaiting USAC review.'
),
(
    '251027334', 2025, '16054321', 'Oak Valley Charter School', 'School',
    'draft', NULL, NULL,
    'Maria Lopez', 'mlopez@oakvalley.edu', '555-0303',
    'Draft application — internal review before certification.'
)
ON CONFLICT (application_number, funding_year) DO NOTHING;

INSERT INTO frns (
    application_id, frn_number, category, service_type, function_type,
    spin, service_provider_name, pre_discount_amount, discount_percentage,
    frn_status, service_start_date, invoicing_deadline,
    committed_amount, disbursed_amount, pia_status, form_486_status, form_473_status, notes
)
SELECT a.id, '259901234567', 1, 'Internet Access', 'Data Transmission',
       '143012345', 'FiberNet Communications', 48000.00, 80.00,
       'pending', '2025-07-01', NULL, 0, 0, 'in_progress', 'not_filed', 'not_filed',
       'Category 1 WAN circuit — PIA documentation submitted.'
FROM applications a WHERE a.application_number = '251025476' AND a.funding_year = 2025
ON CONFLICT (frn_number) DO NOTHING;

INSERT INTO frns (
    application_id, frn_number, category, service_type, function_type,
    spin, service_provider_name, pre_discount_amount, discount_percentage,
    frn_status, service_start_date, invoicing_deadline,
    committed_amount, disbursed_amount, pia_status, form_486_status, form_473_status, notes
)
SELECT a.id, '259901234568', 2, 'Internal Connections', 'Internal Connections',
       '143054321', 'TechConnect Solutions', 125000.00, 80.00,
       'pending', '2025-07-01', NULL, 0, 0, 'not_started', 'not_filed', 'not_filed',
       'C2 switch and wireless refresh — pending PIA.'
FROM applications a WHERE a.application_number = '251025476' AND a.funding_year = 2025
ON CONFLICT (frn_number) DO NOTHING;

INSERT INTO frns (
    application_id, frn_number, category, service_type, function_type,
    spin, service_provider_name, pre_discount_amount, discount_percentage,
    frn_status, service_start_date, invoicing_deadline,
    committed_amount, disbursed_amount, pia_status, form_486_status, form_473_status, notes
)
SELECT a.id, '249801234567', 1, 'Internet Access', 'Data Transmission',
       '143012345', 'FiberNet Communications', 45000.00, 80.00,
       'committed', '2024-07-01', '2029-06-30', 36000.00, 18000.00,
       'complete', 'approved', 'filed',
       'FY2024 WAN — half disbursed.'
FROM applications a WHERE a.application_number = '241025891' AND a.funding_year = 2024
ON CONFLICT (frn_number) DO NOTHING;

INSERT INTO frns (
    application_id, frn_number, category, service_type, function_type,
    spin, service_provider_name, pre_discount_amount, discount_percentage,
    frn_status, service_start_date, invoicing_deadline,
    committed_amount, disbursed_amount, pia_status, form_486_status, form_473_status, notes
)
SELECT a.id, '259901876543', 1, 'Internet Access', 'Data Transmission',
       '143078901', 'ConnectAll ISP', 12000.00, 90.00,
       'pending', '2025-07-01', NULL, 0, 0, 'not_started', 'not_filed', 'not_filed',
       'Library fiber upgrade.'
FROM applications a WHERE a.application_number = '251026102' AND a.funding_year = 2025
ON CONFLICT (frn_number) DO NOTHING;

INSERT INTO status_history (record_type, record_id, old_status, new_status, notes)
SELECT 'application', a.id, 'draft', 'certified', 'Certified in EPC'
FROM applications a WHERE a.application_number = '251025476' AND a.funding_year = 2025;

INSERT INTO status_history (record_type, record_id, old_status, new_status, notes)
SELECT 'application', a.id, 'certified', 'under_review', 'USAC began PIA review'
FROM applications a WHERE a.application_number = '251025476' AND a.funding_year = 2025;

INSERT INTO status_history (record_type, record_id, old_status, new_status, notes)
SELECT 'application', a.id, 'under_review', 'fcdl_issued', 'FCDL wave 8 — all FRNs committed'
FROM applications a WHERE a.application_number = '241025891' AND a.funding_year = 2024;