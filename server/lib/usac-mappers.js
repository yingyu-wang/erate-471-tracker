const APPLICATION_STATUS_MAP = {
  Certified: 'certified',
  Committed: 'fcdl_issued',
  Pending: 'under_review',
  Denied: 'denied',
  Cancelled: 'cancelled',
};

const FRN_STATUS_MAP = {
  Funded: 'committed',
  Pending: 'pending',
  Denied: 'denied',
  Cancelled: 'cancelled',
  'As yet unfunded': 'pending',
};

const FORM_486_STATUS_MAP = {
  Approved: 'approved',
  'Not Filed': 'not_filed',
  'Not Filed Yet': 'not_filed',
  Pending: 'pending',
  Denied: 'denied',
};

const C2_SERVICE_TYPES = new Set([
  'Internal Connections',
  'Managed Internal Broadband Services',
  'Basic Maintenance of Internal Connections',
]);

function parseFundingYear(value) {
  const year = parseInt(value, 10);
  return Number.isFinite(year) ? year : null;
}

function parseDate(value) {
  if (!value) return null;
  return value.slice(0, 10);
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseDiscount(value) {
  const num = parseNumber(value);
  if (num === null) return null;
  return num <= 1 ? num * 100 : num;
}

function mapApplicationStatus(statusName) {
  return APPLICATION_STATUS_MAP[statusName] || 'under_review';
}

function mapFrnStatus(statusName) {
  return FRN_STATUS_MAP[statusName] || 'pending';
}

function mapForm486Status(statusName) {
  if (!statusName) return 'not_filed';
  return FORM_486_STATUS_MAP[statusName] || 'pending';
}

function mapPiaStatus(frn) {
  if (frn.form_471_frn_status_name === 'Funded') return 'complete';
  if (frn.spac_filed === 'Yes') return 'in_progress';
  return 'not_started';
}

function mapCategory(serviceType) {
  return C2_SERVICE_TYPES.has(serviceType) ? 2 : 1;
}

function mapBasicInfoToApplication(row) {
  const contactName = [row.cnct_first_name, row.cnct_last_name].filter(Boolean).join(' ').trim();

  return {
    application_number: row.application_number?.trim(),
    funding_year: parseFundingYear(row.funding_year),
    ben: row.epc_organization_id?.trim() || row.fcc_registration_number?.trim(),
    entity_name: row.organization_name?.trim(),
    entity_type: row.organization_entity_type_name?.trim() || 'School District',
    application_status: mapApplicationStatus(row.form_471_status_name),
    certified_date: parseDate(row.certified_datetime),
    fcdl_date: null,
    contact_name: contactName || null,
    contact_email: row.cnct_email?.trim() || null,
    contact_phone: row.cnct_phone?.trim() || null,
    notes: row.nickname ? `USAC nickname: ${row.nickname}` : 'Imported from USAC Open Data',
  };
}

function mapFrnRowToApplicationFallback(row) {
  return {
    application_number: row.application_number?.trim(),
    funding_year: parseFundingYear(row.funding_year),
    ben: row.ben?.trim(),
    entity_name: row.organization_name?.trim(),
    entity_type: row.organization_entity_type_name?.trim() || 'School District',
    application_status: row.fcdl_letter_date ? 'fcdl_issued' : 'certified',
    certified_date: null,
    fcdl_date: parseDate(row.fcdl_letter_date),
    contact_name: null,
    contact_email: row.cnct_email?.trim() || null,
    contact_phone: null,
    notes: row.nickname ? `USAC nickname: ${row.nickname}` : 'Imported from USAC Open Data (FRN record)',
  };
}

function mapFrnRowToFrn(row, applicationId) {
  const serviceType = row.form_471_service_type_name?.trim() || 'Unknown';

  return {
    application_id: applicationId,
    frn_number: row.funding_request_number?.trim(),
    category: mapCategory(serviceType),
    service_type: serviceType,
    function_type: row.form_471_service_type_name?.trim() || null,
    spin: null,
    service_provider_name: row.spin_name?.trim() || null,
    pre_discount_amount: parseNumber(row.total_pre_discount_costs) ?? 0,
    discount_percentage: parseDiscount(row.dis_pct),
    frn_status: mapFrnStatus(row.form_471_frn_status_name),
    service_start_date: parseDate(row.service_start_date),
    invoicing_deadline: parseDate(row.last_date_to_invoice),
    committed_amount: parseNumber(row.funding_commitment_request) ?? 0,
    disbursed_amount: parseNumber(row.total_authorized_disbursement) ?? 0,
    pia_status: mapPiaStatus(row),
    form_486_status: mapForm486Status(row.f486_case_status),
    form_473_status: row.form_486_no ? 'filed' : 'not_filed',
    notes: row.nickname ? `USAC nickname: ${row.nickname}` : 'Imported from USAC Open Data',
    fcdl_date: parseDate(row.fcdl_letter_date),
  };
}

module.exports = {
  mapApplicationStatus,
  mapFrnStatus,
  mapBasicInfoToApplication,
  mapFrnRowToApplicationFallback,
  mapFrnRowToFrn,
};