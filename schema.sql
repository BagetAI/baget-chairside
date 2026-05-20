-- ============================================================================
-- Chairside Practice Operating System
-- Core Database Schema (PostgreSQL / Supabase)
-- Author: Chairside Database Performance & Optimization Team
-- Target Platform: Supabase PostgreSQL (HIPAA Compliant Configuration)
-- Generated: May 20, 2026
-- ============================================================================

BEGIN;

-- Enable UUID extension for secure, unguessable public identifiers
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. Table: clinics (Multi-tenant partition)
-- ============================================================================
CREATE TABLE IF NOT EXISTS clinics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    pms_type VARCHAR(50) NOT NULL CHECK (pms_type IN ('dentrix', 'eaglesoft', 'open_dental', 'custom', 'none')),
    timezone VARCHAR(100) NOT NULL DEFAULT 'America/New_York',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. Table: beta_signups
-- ============================================================================
CREATE TABLE IF NOT EXISTS beta_signups (
    id BIGSERIAL PRIMARY KEY,
    dentist_name VARCHAR(255) NOT NULL,
    clinic_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(50) NOT NULL,
    chair_count INTEGER NOT NULL CHECK (chair_count BETWEEN 1 AND 50),
    current_software VARCHAR(100) NOT NULL DEFAULT 'None / Spreadsheets',
    signup_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (signup_status IN ('pending', 'contacted', 'onboarded', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for searching/filtering signups by status and timing
CREATE INDEX IF NOT EXISTS idx_beta_signups_status_created ON beta_signups(signup_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beta_signups_email ON beta_signups(email);

-- ============================================================================
-- 3. Table: patients (Synced from PMS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    pms_patient_id VARCHAR(100) NOT NULL, -- External ID from Dentrix/Eaglesoft/Open Dental
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50) NOT NULL,
    dob DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (clinic_id, pms_patient_id)
);

-- Critical indexes for performance on patient joins and communication lookups
CREATE INDEX IF NOT EXISTS idx_patients_clinic_id ON patients(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_lookup ON patients(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);

-- ============================================================================
-- 4. Table: appointments (Self-Bookings and PMS Schedulers)
-- ============================================================================
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    pms_appointment_id VARCHAR(100), -- Nullable for raw self-bookings before PMS sync
    chair_number INTEGER NOT NULL CHECK (chair_number BETWEEN 1 AND 10),
    appointment_type VARCHAR(50) NOT NULL DEFAULT 'hygiene' CHECK (appointment_type IN ('hygiene', 'restorative', 'emergency', 'consultation')),
    status VARCHAR(50) NOT NULL DEFAULT 'pending_sync' CHECK (status IN ('booked_online', 'pending_sync', 'confirmed', 'cancelled', 'no_show')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_appointment_times CHECK (end_time > start_time)
);

-- Crucial indexes for rendering schedule grids (Range filters & joins)
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_time ON appointments(clinic_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

-- ============================================================================
-- 5. Table: pre_authorizations (Visual tracking Kanban)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pre_authorizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    treatment_code VARCHAR(50) NOT NULL, -- e.g., D2740 (Crown) or D6010 (Implant)
    treatment_description VARCHAR(255) NOT NULL,
    insurance_carrier VARCHAR(150) NOT NULL,
    estimated_cost_cents BIGINT NOT NULL DEFAULT 0, -- Stored in cents to avoid float rounding issues
    approved_amount_cents BIGINT DEFAULT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'aging_delay', 'action_required', 'approved', 'declined')),
    reference_number VARCHAR(100),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_checked_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for Kanban dashboard tracking and aging alerts
CREATE INDEX IF NOT EXISTS idx_pre_auth_clinic_status ON pre_authorizations(clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_pre_auth_patient_id ON pre_authorizations(patient_id);
CREATE INDEX IF NOT EXISTS idx_pre_auth_aging ON pre_authorizations(submitted_at DESC) WHERE status = 'submitted';

-- ============================================================================
-- 6. Table: automated_recalls (Continuing Care Loops)
-- ============================================================================
CREATE TABLE IF NOT EXISTS automated_recalls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    recall_type VARCHAR(50) NOT NULL DEFAULT 'hygiene_6_month',
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'delivered', 'responded', 'failed', 'paused')),
    scheduled_send_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    booking_id UUID REFERENCES appointments(id) ON DELETE SET NULL, -- Connects recall success back to booking
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for cron jobs querying matching send triggers
CREATE INDEX IF NOT EXISTS idx_recalls_send_trigger ON automated_recalls(status, scheduled_send_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_recalls_patient_id ON automated_recalls(patient_id);

-- ============================================================================
-- Row Level Security (RLS) Setup for HIPAA Compliance
-- ============================================================================

ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE automated_recalls ENABLE ROW LEVEL SECURITY;
ALTER TABLE beta_signups ENABLE ROW LEVEL SECURITY;

-- Beta Signups: Anyone (anon) can insert signups; only authenticated staff can view
CREATE POLICY signup_insert_policy ON beta_signups 
    FOR INSERT WITH CHECK (true);

CREATE POLICY signup_select_policy ON beta_signups 
    FOR SELECT TO authenticated USING (true);

-- Clinics & Clinical Tables: Lock access strictly to authenticated clinic tenants
CREATE POLICY clinic_tenant_policy ON clinics 
    FOR ALL TO authenticated USING (id = auth.uid());

CREATE POLICY patients_tenant_policy ON patients 
    FOR ALL TO authenticated USING (clinic_id = auth.uid());

CREATE POLICY appointments_tenant_policy ON appointments 
    FOR ALL TO authenticated USING (clinic_id = auth.uid());

CREATE POLICY pre_auth_tenant_policy ON pre_authorizations 
    FOR ALL TO authenticated USING (clinic_id = auth.uid());

CREATE POLICY recalls_tenant_policy ON automated_recalls 
    FOR ALL TO authenticated USING (clinic_id = auth.uid());

COMMIT;
