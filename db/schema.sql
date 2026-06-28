-- USAC E-Rate FCC Form 471 Tracker Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_number VARCHAR(20) NOT NULL,
    funding_year INTEGER NOT NULL CHECK (funding_year >= 1997 AND funding_year <= 2100),
    ben VARCHAR(20) NOT NULL,
    entity_name VARCHAR(255) NOT NULL,
    entity_type VARCHAR(50) NOT NULL DEFAULT 'School District',
    application_status VARCHAR(50) NOT NULL DEFAULT 'draft',
    certified_date DATE,
    fcdl_date DATE,
    contact_name VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (application_number, funding_year)
);

CREATE TABLE IF NOT EXISTS frns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    frn_number VARCHAR(20) NOT NULL UNIQUE,
    category SMALLINT NOT NULL CHECK (category IN (1, 2)),
    service_type VARCHAR(100) NOT NULL,
    function_type VARCHAR(100),
    spin VARCHAR(20),
    service_provider_name VARCHAR(255),
    pre_discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    discount_percentage NUMERIC(5, 2) CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
    frn_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    service_start_date DATE,
    invoicing_deadline DATE,
    committed_amount NUMERIC(14, 2) DEFAULT 0,
    disbursed_amount NUMERIC(14, 2) DEFAULT 0,
    pia_status VARCHAR(50) DEFAULT 'not_started',
    form_486_status VARCHAR(50) DEFAULT 'not_filed',
    form_473_status VARCHAR(50) DEFAULT 'not_filed',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    record_type VARCHAR(20) NOT NULL CHECK (record_type IN ('application', 'frn')),
    record_id UUID NOT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_applications_funding_year ON applications(funding_year);
CREATE INDEX IF NOT EXISTS idx_applications_ben ON applications(ben);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(application_status);
CREATE INDEX IF NOT EXISTS idx_frns_application_id ON frns(application_id);
CREATE INDEX IF NOT EXISTS idx_frns_status ON frns(frn_status);
CREATE INDEX IF NOT EXISTS idx_status_history_record ON status_history(record_type, record_id);

-- USAC import sync metadata (single-row table)
CREATE TABLE IF NOT EXISTS usac_sync_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    state VARCHAR(2) NOT NULL DEFAULT 'CA',
    last_sync_at TIMESTAMPTZ,
    last_sync_mode VARCHAR(20),
    basic_info_rows_updated_at BIGINT,
    frn_status_rows_updated_at BIGINT,
    applications_inserted INTEGER NOT NULL DEFAULT 0,
    applications_updated INTEGER NOT NULL DEFAULT 0,
    applications_unchanged INTEGER NOT NULL DEFAULT 0,
    frns_inserted INTEGER NOT NULL DEFAULT 0,
    frns_updated INTEGER NOT NULL DEFAULT 0,
    frns_unchanged INTEGER NOT NULL DEFAULT 0,
    skipped_reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE applications ADD COLUMN IF NOT EXISTS usac_source_hash VARCHAR(64);
ALTER TABLE frns ADD COLUMN IF NOT EXISTS usac_source_hash VARCHAR(64);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS applications_updated_at ON applications;
CREATE TRIGGER applications_updated_at
    BEFORE UPDATE ON applications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS frns_updated_at ON frns;
CREATE TRIGGER frns_updated_at
    BEFORE UPDATE ON frns
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();