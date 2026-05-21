-- baza_chairside: High-Performance Database Queries & Optimization Examples
-- This file documents common real-world queries used by the Chairside dashboard.
-- All queries are designed to operate perfectly at scale and prevent N+1 query patterns.

-- 1. ENHANCED PRE-AUTHORIZATION KANBAN BOARD QUERY
-- Efficiently group and load treatments pending insurance approval by status,
-- retrieving critical estimated copay amounts, insurance reference numbers, and deadlines.
-- Uses the 'idx_pre_auths_kanban_dashboard' composite index for optimal sorting and filtering.
EXPLAIN ANALYZE
SELECT 
    pa.id,
    pa.status,
    pa.treatment_description,
    pa.estimated_cost_cents,
    pa.estimated_copay_cents,
    pa.claim_reference_number,
    pa.deadline_date,
    pa.submitted_at,
    p.id AS patient_id,
    p.first_name AS patient_first_name,
    p.last_name AS patient_last_name,
    p.phone AS patient_phone
FROM pre_authorizations pa
JOIN patients p ON pa.patient_id = p.id
WHERE pa.clinic_id = 'e2ba847c-fc99-4b67-8547-8a186bfa33f6' -- Specific clinic ID (Tenant separation)
  AND pa.status IN ('submitted', 'pending_info')
ORDER BY pa.status, pa.deadline_date ASC NULLS LAST, pa.updated_at DESC;


-- 2. URGENT DEADLINES EXPIRED/EXPIRING AUDIT
-- Scans for pre-authorizations where insurance decision is lagging or close to deadline.
-- Uses the partial index 'idx_pre_auths_urgent_deadlines' to scan minimal rows.
EXPLAIN ANALYZE
SELECT 
    pa.id,
    pa.treatment_description,
    pa.deadline_date,
    p.first_name AS patient_first_name,
    p.last_name AS patient_last_name,
    pa.insurance_provider
FROM pre_authorizations pa
JOIN patients p ON pa.patient_id = p.id
WHERE pa.clinic_id = 'e2ba847c-fc99-4b67-8547-8a186bfa33f6'
  AND pa.status IN ('submitted', 'pending_info')
  AND pa.deadline_date <= CURRENT_DATE + INTERVAL '5 days'
ORDER BY pa.deadline_date ASC;


-- 3. PREVENTING N+1: RETRIEVING PATIENTS WITH UPCOMING APPOINTMENTS & SMS REMINDERS
-- Uses a single query with JSON aggregation to pull patient data, appointment details, and message logs
-- in one roundtrip instead of running loops in the application layer.
EXPLAIN ANALYZE
SELECT 
    p.id AS patient_id,
    p.first_name,
    p.last_name,
    p.phone,
    -- Aggregate appointments safely using JSON
    COALESCE(
        json_agg(DISTINCT jsonb_build_object(
            'id', a.id,
            'start_time', a.start_time,
            'treatment_type', a.treatment_type,
            'status', a.status
        )) FILTER (WHERE a.id IS NOT NULL), 
        '[]'
    ) AS appointments,
    -- Aggregate SMS reminder history
    COALESCE(
        json_agg(DISTINCT jsonb_build_object(
            'id', sms.id,
            'type', sms.type,
            'status', sms.status,
            'scheduled_for', sms.scheduled_for
        )) FILTER (WHERE sms.id IS NOT NULL), 
        '[]'
    ) AS sms_history
FROM patients p
LEFT JOIN appointments a ON a.patient_id = p.id AND a.start_time >= NOW()
LEFT JOIN sms_reminders sms ON sms.patient_id = p.id
WHERE p.clinic_id = 'e2ba847c-fc99-4b67-8547-8a186bfa33f6'
GROUP BY p.id
LIMIT 50;


-- 4. THE RECALL SELECTOR (Finding candidates for automated text messages)
-- Identifies patients who are past due for their 6-month hygiene recall
-- Uses partial index 'idx_patients_recall' for rapid sub-millisecond scans.
EXPLAIN ANALYZE
SELECT 
    id,
    first_name,
    last_name,
    phone,
    next_recall_due_date
FROM patients
WHERE clinic_id = 'e2ba847c-fc99-4b67-8547-8a186bfa33f6'
  AND next_recall_due_date <= CURRENT_DATE
  AND (last_recall_at IS NULL OR last_recall_at < NOW() - INTERVAL '30 days') -- Don't spam patients more than once a month
ORDER BY next_recall_due_date ASC
LIMIT 100;


-- 5. VACANT SELF-BOOKING SLOTS FOR WIDGET
-- Loads open time slots for patients booking online, filtering out temporarily held slots.
EXPLAIN ANALYZE
SELECT 
    id,
    chair_number,
    start_time,
    end_time
FROM booking_slots
WHERE clinic_id = 'e2ba847c-fc99-4b67-8547-8a186bfa33f6'
  AND start_time BETWEEN NOW() AND NOW() + INTERVAL '14 days'
  AND (is_reserved = FALSE OR (is_reserved = TRUE AND reserved_until < NOW()))
ORDER BY start_time ASC;
