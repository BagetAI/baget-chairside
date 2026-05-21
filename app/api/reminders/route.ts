import { NextResponse } from 'next/server';
import { Pool } from 'pg';

// Initialize PostgreSQL connection pool using environment database URL
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

interface TwilioResponse {
  sid?: string;
  error_message?: string;
  status?: string;
}

export async function POST(request: Request) {
  // 1. Enforce strict Bearer Token Authorization to secure the CRON trigger
  const authHeader = request.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET is not set.' },
      { status: 500 }
    );
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing authorization header.' },
      { status: 401 }
    );
  }

  // Verify Twilio Environment variables are set
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_FROM_NUMBER;

  if (!twilioSid || !twilioAuthToken || !twilioFrom) {
    return NextResponse.json(
      { error: 'Server misconfiguration: Twilio environment variables are missing.' },
      { status: 500 }
    );
  }

  const client = await dbPool.connect();
  const results = {
    queuedRecalls: 0,
    queuedReminders: 0,
    processedSMS: {
      success: 0,
      failed: 0,
      details: [] as Array<{ id: string; phone: string; status: string; sid?: string; error?: string }>
    }
  };

  try {
    await client.query('BEGIN');

    // =========================================================================
    // STEP 1: AUTO-QUEUE OVERDUE HYGIENE RECALLS (Zero-IT automation)
    // Find active patients past their recall due date who don't have a pending/sent recall SMS in the last 30 days.
    // =========================================================================
    const recallQuery = `
      INSERT INTO sms_reminders (clinic_id, patient_id, type, status, phone_number, message_body, scheduled_for)
      SELECT 
        p.clinic_id,
        p.id as patient_id,
        'recall' as type,
        'pending' as status,
        p.phone as phone_number,
        replace(c.sms_recall_template, '{{patient_name}}', p.first_name) as message_body,
        NOW() as scheduled_for
      FROM patients p
      JOIN clinics c ON p.clinic_id = c.id
      WHERE p.next_recall_due_date <= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM sms_reminders sr 
          WHERE sr.patient_id = p.id 
            AND sr.type = 'recall' 
            AND (sr.status = 'pending' OR (sr.status = 'sent' AND sr.sent_at >= NOW() - INTERVAL '30 days'))
        )
      RETURNING id;
    `;
    const recallResult = await client.query(recallQuery);
    results.queuedRecalls = recallResult.rowCount || 0;

    // =========================================================================
    // STEP 2: AUTO-QUEUE 24-HOUR APPOINTMENT REMINDERS
    // Find active appointments scheduled to start in the next 24 to 28 hours that don't have a queued reminder yet.
    // =========================================================================
    const appointmentReminderQuery = `
      INSERT INTO sms_reminders (clinic_id, patient_id, appointment_id, type, status, phone_number, message_body, scheduled_for)
      SELECT 
        a.clinic_id,
        a.patient_id,
        a.id as appointment_id,
        '24h_reminder' as type,
        'pending' as status,
        p.phone as phone_number,
        'Hi ' || p.first_name || ', this is a reminder of your upcoming appointment for ' || a.treatment_type || ' tomorrow at ' || TO_CHAR(a.start_time AT TIME ZONE c.timezone, 'HH12:MI AM') || '. Reply YES to confirm.',
        a.start_time - INTERVAL '24 hours' as scheduled_for
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN clinics c ON a.clinic_id = c.id
      WHERE a.start_time BETWEEN NOW() + INTERVAL '20 hours' AND NOW() + INTERVAL '28 hours'
        AND a.status = 'scheduled'
        AND NOT EXISTS (
          SELECT 1 FROM sms_reminders sr 
          WHERE sr.appointment_id = a.id 
            AND sr.type = '24h_reminder'
        )
      RETURNING id;
    `;
    const appointmentResult = await client.query(appointmentReminderQuery);
    results.queuedReminders = appointmentResult.rowCount || 0;

    await client.query('COMMIT');

    // =========================================================================
    // STEP 3: PROCESS THE PENDING SMS REMINDERS QUEUE
    // Fetch up to 50 reminders scheduled for now or in the past that are in 'pending' status.
    // =========================================================================
    const fetchPendingQuery = `
      SELECT id, clinic_id, phone_number, message_body 
      FROM sms_reminders 
      WHERE status = 'pending' 
        AND scheduled_for <= NOW()
      LIMIT 50
      FOR UPDATE SKIP LOCKED;
    `;
    const pendingResult = await client.query(fetchPendingQuery);
    const pendingReminders = pendingResult.rows;

    const authString = Buffer.from(`${twilioSid}:${twilioAuthToken}`).toString('base64');
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;

    for (const sms of pendingReminders) {
      try {
        // Safe sanitization of phone numbers to E.164 format for Twilio (assumes US country code +1 if missing)
        let formattedPhone = sms.phone_number.replace(/\D/g, '');
        if (formattedPhone.length === 10) {
          formattedPhone = `+1${formattedPhone}`;
        } else if (!formattedPhone.startsWith('+')) {
          formattedPhone = `+${formattedPhone}`;
        }

        // Send POST request directly to Twilio's HTTP REST API to keep the bundle size small
        const twilioResponse = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            From: twilioFrom,
            To: formattedPhone,
            Body: sms.message_body,
          }).toString(),
        });

        const data = (await twilioResponse.json()) as TwilioResponse;

        if (twilioResponse.ok && data.sid) {
          // Update DB row: SMS sent successfully
          await client.query(
            `UPDATE sms_reminders 
             SET status = 'sent', sent_at = NOW(), external_provider_sid = $1, error_message = NULL, updated_at = NOW() 
             WHERE id = $2`,
            [data.sid, sms.id]
          );

          results.processedSMS.success++;
          results.processedSMS.details.push({
            id: sms.id,
            phone: formattedPhone,
            status: 'sent',
            sid: data.sid
          });
        } else {
          // Twilio rejected or threw error payload
          const errMsg = data.error_message || `Twilio error response (Status ${twilioResponse.status})`;
          await client.query(
            `UPDATE sms_reminders 
             SET status = 'failed', error_message = $1, updated_at = NOW() 
             WHERE id = $2`,
            [errMsg, sms.id]
          );

          results.processedSMS.failed++;
          results.processedSMS.details.push({
            id: sms.id,
            phone: formattedPhone,
            status: 'failed',
            error: errMsg
          });
        }
      } catch (smsError: any) {
        // Network or fetch level failures
        await client.query(
          `UPDATE sms_reminders 
           SET status = 'failed', error_message = $1, updated_at = NOW() 
           WHERE id = $2`,
          [smsError.message || 'Unknown transport error', sms.id]
        );

        results.processedSMS.failed++;
        results.processedSMS.details.push({
          id: sms.id,
          phone: sms.phone_number,
          status: 'failed',
          error: smsError.message || 'Unknown fetch error'
        });
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results
    });

  } catch (error: any) {
    await client.query('ROLLBACK');
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Database transaction failed during execution.',
        details: error.stack 
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
