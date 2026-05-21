-- Migration: 02_pre_auth_tracker.sql
-- Optimizes and enhances pre-authorization tracking with copays, deadline tracking, and status lookup optimization.

BEGIN;

-- 1. ENHANCE PRE-AUTHORIZATIONS TABLE WITH COPAYS AND DEADLINES
-- Add nullable columns if they do not exist
ALTER TABLE pre_authorizations 
ADD COLUMN IF NOT EXISTS estimated_copay_cents BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS deadline_date DATE,
ADD COLUMN IF NOT EXISTS claim_reference_number VARCHAR(100);

-- Ensure there is a CHECK constraint for allowed statuses
-- Statuses: draft, submitted, pending_info, approved, denied
ALTER TABLE pre_authorizations
DROP CONSTRAINT IF EXISTS chk_pre_auth_status,
ADD CONSTRAINT chk_pre_auth_status CHECK (status IN ('draft', 'submitted', 'pending_info', 'approved', 'denied'));

-- 2. PERFORMANCE OPTIMIZED INDEXES FOR OFFICE MANAGERS
-- Drop existing basic kanban index if we want to replace it with a more performant composite index
DROP INDEX IF EXISTS idx_pre_auths_kanban;

-- Perfect compound index for Kanban board: groups by clinic, filters by status, and sorts by deadline (for urgent cases) or updated_at
CREATE INDEX idx_pre_auths_kanban_dashboard 
ON pre_authorizations(clinic_id, status, deadline_date ASC NULLS LAST, updated_at DESC);

-- Partial index for active alerts (unapproved claims with deadlines approaching)
CREATE INDEX idx_pre_auths_urgent_deadlines
ON pre_authorizations(clinic_id, deadline_date ASC)
WHERE status IN ('submitted', 'pending_info');

COMMIT;
