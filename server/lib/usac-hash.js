const crypto = require('crypto');

function stableStringify(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${k}:${stableStringify(value[k])}`).join(',')}}`;
}

function hashFields(fields) {
  return crypto.createHash('sha256').update(stableStringify(fields)).digest('hex');
}

const APPLICATION_SOURCE_FIELDS = [
  'application_number',
  'funding_year',
  'epc_organization_id',
  'fcc_registration_number',
  'organization_name',
  'organization_entity_type_name',
  'form_471_status_name',
  'certified_datetime',
  'cnct_first_name',
  'cnct_last_name',
  'cnct_email',
  'cnct_phone',
  'nickname',
];

const FRN_SOURCE_FIELDS = [
  'application_number',
  'funding_year',
  'funding_request_number',
  'ben',
  'organization_name',
  'organization_entity_type_name',
  'form_471_service_type_name',
  'spin_name',
  'total_pre_discount_costs',
  'dis_pct',
  'form_471_frn_status_name',
  'service_start_date',
  'last_date_to_invoice',
  'funding_commitment_request',
  'total_authorized_disbursement',
  'spac_filed',
  'f486_case_status',
  'form_486_no',
  'fcdl_letter_date',
  'nickname',
  'cnct_email',
];

function pickFields(row, fieldNames) {
  const picked = {};
  for (const name of fieldNames) {
    picked[name] = row[name] ?? null;
  }
  return picked;
}

function hashApplicationRow(row) {
  return hashFields(pickFields(row, APPLICATION_SOURCE_FIELDS));
}

function hashFrnRow(row) {
  return hashFields(pickFields(row, FRN_SOURCE_FIELDS));
}

module.exports = {
  hashApplicationRow,
  hashFrnRow,
};