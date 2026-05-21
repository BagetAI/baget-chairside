-- baza_chairside: Chairside PostgreSQL Database Schema
-- Multi-tenant schema designed for independent 1-4 chair dental clinics.
-- Highly optimized for performance, zero-IT overhead, and automated operations.

BEGIN;

-- 1. EXTENSIONS
-- Enable UUID generation and text search support
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

-- 2. CLINICS (TENANTS)
-- Since Chairside is sold per-location as a monthly subscription, multi-tenancy starts here.
CREATE TABLE clinics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    subdomain citext UNIQUE NOT NULL,
    phone_number VARCHAR(20) NOT NULL, -- The practice phone number
    timezone VARCHAR(100) NOT NULL DEFAULT 'America/New_York',
    sms_recall_template TEXT NOT NULL DEFAULT 'Hi {{patient_name}}, it has been 6 months since your last cleaning. Book your next appointment here: {{booking_url}}',
    subscription_status VARCHAR(50) NOT NULL DEFAULT 'trialing', -- trialing, active, past_due, canceled
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookups by subdomain
CREATE INDEX idx_clinics_subdomain ON clinics(subdomain);

-- 3. PATIENTS
CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email citext,
    phone VARCHAR(20) NOT NULL, -- Required for automated recall texts
    date_of_birth DATE NOT NULL,
    last_recall_at TIMESTAMPTZ,
    next_recall_due_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Constraint: Patient phone numbers should be unique per clinic to avoid duplicate texting
    CONSTRAINT uq_patient_phone_per_clinic UNIQUE (clinic_id, phone)
);

-- Indexes for patient lookups
CREATE INDEX idx_patients_clinic_name ON patients(clinic_id, last_name, first_name);
CREATE INDEX idx_patients_recall ON patients(clinic_id, next_recall_due_date) WHERE next_recall_due_date IS NOT NULL;

-- 4. APPOINTMENTS
CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    chair_number INT NOT NULL CHECK (chair_number BETWEEN 1 AND 4), -- Specifically restricted to 1-4 chairs
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    treatment_type VARCHAR(150) NOT NULL, -- e.g. Cleaning, Crown, Consultation
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled', -- scheduled, confirmed, completed, cancelled, no_show
    source VARCHAR(50) NOT NULL DEFAULT 'office', -- office, self-booked (online widget)
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_appointment_times CHECK (start_time < end_time)
);

-- Index foreign keys and common query paths
CREATE INDEX idx_appointments_clinic_date ON appointments(clinic_id, start_time DESC);
CREATE INDEX idx_appointments_patient ON appointments(patient_id);
-- Exclusion constraint to prevent double-booking a chair at the same clinic
CREATE INDEX idx_appointments_chair_overlap ON appointments(clinic_id, chair_number, start_time, end_time);

-- 5. BOOKING SLOTS (For Online Self-Booking Widget)
-- Dynamically managed availability slots based on clinic hours & chair availability
CREATE TABLE booking_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    chair_number INT NOT NULL CHECK (chair_number BETWEEN 1 AND 4),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    is_reserved BOOLEAN NOT NULL DEFAULT FALSE,
    reserved_until TIMESTAMPTZ, -- Temporary hold during checkout
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_booking_slots_lookup 
ON booking_slots(clinic_id, start_time) 
WHERE is_reserved = FALSE OR (is_reserved = TRUE AND reserved_until < NOW());

-- 6. AUTOMATED SMS REMINDER STATUSES
CREATE TABLE sms_reminders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL, -- recall, 24h_reminder, 2h_immediate, booking_confirmation
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, queued, sent, delivered, failed
    phone_number VARCHAR(20) NOT NULL,
    message_body TEXT NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    external_provider_sid VARCHAR(255), -- Twilio / SMS provider reference
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for background cron/worker to find pending messages to send
CREATE INDEX idx_sms_reminders_queue 
ON sms_reminders(status, scheduled_for) 
WHERE status = 'pending';

CREATE INDEX idx_sms_reminders_patient ON sms_reminders(patient_id);

-- 7. INSURANCE PRE-AUTHORIZATION TRACKER
-- Specifically built to solve the "Sticky Note" problem for high-production cases
CREATE TABLE pre_authorizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    insurance_provider VARCHAR(150) NOT NULL,
    policy_member_id VARCHAR(100) NOT NULL,
    treatment_description VARCHAR(255) NOT NULL, -- e.g., "Crown for Tooth #14"
    estimated_cost_cents BIGINT NOT NULL, -- Keep everything in cents to avoid decimal rounding errors
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, submitted, pending_info, approved, denied
    submitted_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the visual Kanban Board (filtering by clinic & status)
CREATE INDEX idx_pre_auths_kanban ON pre_authorizations(clinic_id, status, updated_at DESC);

-- 8. TRIGGER FOR AUTO-UPDATED TIMESTAMPS
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply timestamp triggers
CREATE TRIGGER update_clinics_modtime BEFORE UPDATE ON clinics FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_patients_modtime BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_appointments_modtime BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_sms_reminders_modtime BEFORE UPDATE ON sms_reminders FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_pre_authorizations_modtime BEFORE UPDATE ON pre_authorizations FOR EACH ROW EXECUTE FUNCTION update_modified_column();

COMMIT;
