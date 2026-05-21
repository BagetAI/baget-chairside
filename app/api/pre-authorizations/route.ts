import { NextResponse } from 'next/server';
import { Pool } from 'pg';

// Initialize PostgreSQL connection pool using environment database URL
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Allowed pre-authorization statuses based on check constraint
const VALID_STATUSES = ['draft', 'submitted', 'pending_info', 'approved', 'denied'];

export async function PATCH(request: Request) {
  // 1. Enforce Authentication
  const authHeader = request.headers.get('Authorization');
  const apiKey = process.env.CHAIRSIDE_API_KEY || process.env.CRON_SECRET;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Server misconfiguration: API authentication key is not configured.' },
      { status: 500 }
    );
  }

  if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing authorization token.' },
      { status: 401 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid JSON request body.' },
      { status: 400 }
    );
  }

  const { id, status, notes, claim_reference_number, estimated_copay_cents, changed_by } = body;

  // 2. Validate input variables
  if (!id) {
    return NextResponse.json(
      { error: 'Missing required field: id' },
      { status: 400 }
    );
  }

  if (!status) {
    return NextResponse.json(
      { error: 'Missing required field: status' },
      { status: 400 }
    );
  }

  const normalizedStatus = status.toLowerCase();
  if (!VALID_STATUSES.includes(normalizedStatus)) {
    return NextResponse.json(
      { error: `Invalid status code. Must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 }
    );
  }

  const client = await dbPool.connect();

  try {
    // Self-healing database pattern: Ensure history log table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS pre_authorization_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pre_authorization_id UUID NOT NULL REFERENCES pre_authorizations(id) ON DELETE CASCADE,
        old_status VARCHAR(50),
        new_status VARCHAR(50) NOT NULL,
        changed_by VARCHAR(150) NOT NULL DEFAULT 'system',
        changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes TEXT
      );
    `);

    await client.query('BEGIN');

    // Fetch the current record to check existence and record history log transition
    const currentRecordQuery = `
      SELECT status, notes, clinic_id 
      FROM pre_authorizations 
      WHERE id = $1
    `;
    const currentResult = await client.query(currentRecordQuery, [id]);

    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Pre-authorization claim record not found.' },
        { status: 404 }
      );
    }

    const currentRecord = currentResult.rows[0];
    const oldStatus = currentRecord.status;

    // Determine values to update dynamically or fall back to current values
    const finalClaimRef = claim_reference_number !== undefined ? claim_reference_number : null;
    const finalCopay = estimated_copay_cents !== undefined ? parseInt(estimated_copay_cents, 10) : null;
    const finalNotes = notes || currentRecord.notes;

    // Build the dynamic update query to preserve other fields
    let updateQuery = `
      UPDATE pre_authorizations 
      SET 
        status = $1,
        updated_at = NOW(),
        responded_at = CASE WHEN $1 IN ('approved', 'denied') THEN NOW() ELSE responded_at END
    `;
    
    const updateParams = [normalizedStatus, id];
    let paramCounter = 3;

    if (finalClaimRef !== null) {
      updateQuery += `, claim_reference_number = $${paramCounter}`;
      updateParams.push(finalClaimRef);
      paramCounter++;
    }

    if (finalCopay !== null) {
      updateQuery += `, estimated_copay_cents = $${paramCounter}`;
      updateParams.push(finalCopay);
      paramCounter++;
    }

    if (finalNotes !== undefined) {
      updateQuery += `, notes = $${paramCounter}`;
      updateParams.push(finalNotes);
      paramCounter++;
    }

    updateQuery += ` WHERE id = $2 RETURNING *`;

    const updateResult = await client.query(updateQuery, updateParams);
    const updatedRecord = updateResult.rows[0];

    // Log the transaction history inside our audit trail
    const logQuery = `
      INSERT INTO pre_authorization_history (
        pre_authorization_id, old_status, new_status, changed_by, notes
      ) VALUES ($1, $2, $3, $4, $5)
    `;
    await client.query(logQuery, [
      id,
      oldStatus,
      normalizedStatus,
      changed_by || 'office_manager_api',
      `Status transitioned from "${oldStatus}" to "${normalizedStatus}".${notes ? ` Notes: ${notes}` : ''}`
    ]);

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      message: 'Pre-authorization pipeline status transitioned successfully.',
      timestamp: new Date().toISOString(),
      transition: {
        id,
        from: oldStatus,
        to: normalizedStatus,
        clinic_id: currentRecord.clinic_id
      },
      record: updatedRecord
    });

  } catch (error: any) {
    await client.query('ROLLBACK');
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Database transaction failed during pre-authorization patch.',
        details: error.stack 
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
