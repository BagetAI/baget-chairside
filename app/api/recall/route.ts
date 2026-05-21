import { NextResponse } from 'next/server';
import { Pool } from 'pg';

// Initialize PostgreSQL connection pool using environment database URL
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function POST(request: Request) {
  // 1. Enforce strict Bearer Token Authorization to secure the endpoint
  const authHeader = request.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET || process.env.CHAIRSIDE_API_KEY;

  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: Security tokens are not configured.' },
      { status: 500 }
    );
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing authorization header.' },
      { status: 401 }
    );
  }

  // 2. Validate Twilio credentials exist in the system (required to draft payloads)
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_FROM_NUMBER || '+15005550006';

  if (!twilioSid || !twilioAuthToken) {
    return NextResponse.json(
      { error: 'Server misconfiguration: Twilio integration variables are missing.' },
      { status: 500 }
    );
  }

  const client = await dbPool.connect();
  const summary = {
    scannedCount: 0,
    draftedCount: 0,
    drafts: [] as Array<{
      patientId: string;
      patientName: string;
      phone: string;
      clinicId: string;
      smsBody: string;
      twilioPayload: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body: string;
      };
    }>
  };

  try {
    // Begin transaction for safety and rollback capability
    await client.query('BEGIN');

    // 3. Scan Patient database for patients overdue for 6-month hygiene visits.
    // Overdue patients have next_recall_due_date <= CURRENT_DATE.
    // To prevent duplicate outreach, ensure no active 'pending' or recently 'sent' (within last 30 days) recall SMS exists.
    const query = `
      SELECT 
        p.id AS patient_id,
        p.first_name,
        p.last_name,
        p.phone,
        p.clinic_id,
        c.sms_recall_template,
        c.name AS clinic_name
      FROM patients p
      JOIN clinics c ON p.clinic_id = c.id
      WHERE p.next_recall_due_date <= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM sms_reminders sr 
          WHERE sr.patient_id = p.id 
            AND sr.type = 'recall' 
            AND (sr.status = 'pending' OR (sr.status = 'sent' AND sr.sent_at >= NOW() - INTERVAL '30 days'))
        )
      LIMIT 100
      FOR UPDATE SKIP LOCKED;
    `;

    const { rows } = await client.query(query);
    summary.scannedCount = rows.length;

    const authString = Buffer.from(`${twilioSid}:${twilioAuthToken}`).toString('base64');
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;

    for (const patient of rows) {
      // Format template variables cleanly
      const personalizedMessage = patient.sms_recall_template
        ? patient.sms_recall_template
            .replace('{{patient_name}}', patient.first_name)
            .replace('{{booking_url}}', `https://${patient.clinic_name.toLowerCase().replace(/\s+/g, '')}.chairside.app/book`)
        : `Hi ${patient.first_name}, it has been 6 months since your last cleaning. Book your next appointment here: https://chairside.app/book`;

      // 4. Create and commit draft sms_reminders entry
      const insertQuery = `
        INSERT INTO sms_reminders (
          clinic_id, 
          patient_id, 
          type, 
          status, 
          phone_number, 
          message_body, 
          scheduled_for,
          created_at,
          updated_at
        ) VALUES ($1, $2, 'recall', 'pending', $3, $4, NOW(), NOW(), NOW())
        RETURNING id;
      `;
      const insertResult = await client.query(insertQuery, [
        patient.clinic_id,
        patient.patient_id,
        patient.phone,
        personalizedMessage
      ]);

      // Format E.164 phone safely for Twilio
      let formattedPhone = patient.phone.replace(/\D/g, '');
      if (formattedPhone.length === 10) {
        formattedPhone = `+1${formattedPhone}`;
      } else if (!formattedPhone.startsWith('+')) {
        formattedPhone = `+${formattedPhone}`;
      }

      // Generate the exact HTTP payload for direct Twilio API calls
      const twilioBody = new URLSearchParams({
        From: twilioFrom,
        To: formattedPhone,
        Body: personalizedMessage,
      }).toString();

      summary.drafts.push({
        patientId: patient.patient_id,
        patientName: `${patient.first_name} ${patient.last_name}`,
        phone: formattedPhone,
        clinicId: patient.clinic_id,
        smsBody: personalizedMessage,
        twilioPayload: {
          url: twilioUrl,
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: twilioBody,
        }
      });
    }

    summary.draftedCount = summary.drafts.length;

    // Commit all changes in the transaction safely
    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary
    });

  } catch (error: any) {
    // Safe transactional rollback in case of queries crashing
    await client.query('ROLLBACK');
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Database transaction rolled back due to error.',
        details: error.stack 
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
