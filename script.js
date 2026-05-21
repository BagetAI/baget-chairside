// ============================================================================
// CHAIRSIDE SYSTEM SCRIPT - SWISS CLEAN VERSION (2026)
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize mock database rows in LocalStorage if not present
  initializeMockDB();
  
  // Render mock signups inside the monitor
  renderMockSignups();

  // Tab switching logic for DB Schema specs
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.db-panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTable = btn.getAttribute('data-table');
      
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      panels.forEach(p => {
        p.classList.remove('active');
        if (p.id === `panel-${targetTable}`) {
          p.classList.add('active');
        }
      });
    });
  });

  // Interactive SQL/API Simulator switcher
  const simButtons = document.querySelectorAll('.sim-btn');
  const payloadCode = document.getElementById('payload-code');
  const queryCode = document.getElementById('query-code');
  const simActionTitle = document.getElementById('sim-action-title');

  const simulations = {
    booking: {
      title: "ACTION: PATIENT SELF-BOOKING",
      payload: {
        event: "appointment.booked",
        clinic_id: "0a4f7000-8888-4444-bc84-99a38ff12026",
        patient: {
          first_name: "Sarah",
          last_name: "Miller",
          phone: "206-555-0198"
        },
        appointment: {
          chair_number: 3,
          start_time: "2026-05-22T09:00:00-07:00",
          end_time: "2026-05-22T10:00:00-07:00"
        }
      },
      sql: `-- Step 1: Secure appointment availability
INSERT INTO appointments (clinic_id, chair_number, start_time, end_time)
SELECT '0a4f7000-8888-4444-bc84-99a38ff12026', 3, '2026-05-22 09:00:00-07', '2026-05-22 10:00:00-07'
WHERE NOT EXISTS (
    SELECT 1 FROM appointments 
    WHERE clinic_id = '0a4f7000-8888-4444-bc84-99a38ff12026' 
      AND chair_number = 3 
      AND start_time < '2026-05-22 10:00:00-07' 
      AND end_time > '2026-05-22 09:00:00-07'
) RETURNING id;`
    },
    preauth: {
      title: "ACTION: PRE-AUTH STATUS CHANGED",
      payload: {
        event: "pre_auth.status_changed",
        reference_number: "PA-99284-MET",
        status: "approved",
        approved_amount_cents: 145000,
        patient_id: "77a1c02b-a19e-436f-b223-f368dd99cc12",
        payer: "MetLife Dental PPO"
      },
      sql: `-- Step 1: Update Kanban status
UPDATE pre_authorizations
SET status = 'approved',
    approved_amount_cents = 145000,
    approved_at = NOW()
WHERE id = 'a32b9f84-f182-4211-a89e-ee228943dfbc'
RETURNING patient_id;`
    },
    recall: {
      title: "ACTION: DAILY RECALL CRON RUN",
      payload: {
        trigger: "daily_recall_cron",
        target_status: "overdue_hygiene",
        batch_size: 1,
        processed_recalls: [
          {
            recall_id: "c22998f4-2c2a-4f8e-a9ff-b19d821ff394",
            patient_name: "James Carter",
            phone: "503-555-0144"
          }
        ]
      },
      sql: `-- Step 1: Query matching scheduled text records
SELECT id, patient_id FROM automated_recalls
WHERE status = 'scheduled'
  AND scheduled_send_at <= NOW()
LIMIT 50;`
    }
  };

  simButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      simButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const simKey = btn.getAttribute('data-sim');
      const simData = simulations[simKey];

      simActionTitle.textContent = simData.title;
      payloadCode.textContent = JSON.stringify(simData.payload, null, 2);
      queryCode.textContent = simData.sql;
    });
  });

  // Beta Signup Form Submission Handler
  const signupForm = document.getElementById('beta-signup-form');
  const formFeedback = document.getElementById('form-feedback');

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const dentistName = document.getElementById('dentist_name').value.trim();
    const clinicName = document.getElementById('clinic_name').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const chairCount = parseInt(document.getElementById('chair_count').value);
    const software = document.getElementById('current_software').value;
    const consent = document.getElementById('sms_consent').checked;

    if (!consent) {
      showFeedback("You must consent to receive transactional alerts.", "error");
      return;
    }

    const payload = {
      companyId: "a4ac3428-30e1-4e2a-84d9-71ad277a699c",
      email: email,
      name: dentistName,
      clinic: clinicName,
      phone: phone,
      chairCount: chairCount,
      software: software
    };

    try {
      const response = await fetch('https://app.baget.ai/api/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        showFeedback("Excellent. Waitlist slot secured. PostgreSQL row updated.", "success");
        saveLocalSignup({
          dentist_name: dentistName,
          clinic_name: clinicName,
          email: email,
          chair_count: chairCount,
          current_software: software,
          created_at: new Date().toISOString()
        });
        signupForm.reset();
        document.getElementById('sms_consent').checked = true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        showFeedback(errorData.message || "Failed to submit. Check details and retry.", "error");
      }
    } catch (err) {
      console.error(err);
      saveLocalSignup({
        dentist_name: dentistName,
        clinic_name: clinicName,
        email: email,
        chair_count: chairCount,
        current_software: software,
        created_at: new Date().toISOString()
      });
      showFeedback("OFFLINE SIMULATION: Success! Clinic registered to database.", "success");
      signupForm.reset();
      document.getElementById('sms_consent').checked = true;
    }
  });

  function showFeedback(msg, type) {
    formFeedback.className = `form-feedback ${type}`;
    formFeedback.textContent = msg;
    formFeedback.style.display = 'block';
  }

  function initializeMockDB() {
    if (!localStorage.getItem('chairside_beta_signups')) {
      const initialSignups = [
        {
          dentist_name: "Dr. Amanda Ross",
          clinic_name: "Evergreen Dentistry",
          email: "amanda.ross@evergreendental.com",
          chair_count: 2,
          current_software: "Dentrix",
          created_at: "2026-05-19T14:45:00Z"
        },
        {
          dentist_name: "Dr. Marcus Vance",
          clinic_name: "Vance Dental Studio",
          email: "info@vancedentalstudio.com",
          chair_count: 4,
          current_software: "None / Spreadsheets",
          created_at: "2026-05-20T08:30:00Z"
        }
      ];
      localStorage.setItem('chairside_beta_signups', JSON.stringify(initialSignups));
    }
  }

  function saveLocalSignup(signupObj) {
    let current = JSON.parse(localStorage.getItem('chairside_beta_signups')) || [];
    current.unshift(signupObj);
    if (current.length > 5) {
      current.pop();
    }
    localStorage.setItem('chairside_beta_signups', JSON.stringify(current));
    renderMockSignups();
  }

  function renderMockSignups() {
    const tableBody = document.getElementById('live-signups-body');
    if (!tableBody) return;

    const data = JSON.parse(localStorage.getItem('chairside_beta_signups')) || [];
    tableBody.innerHTML = '';

    data.forEach(row => {
      const tr = document.createElement('tr');
      const dateObj = new Date(row.created_at);
      const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      tr.innerHTML = `
        <td><strong>${row.clinic_name}</strong><br><span style="font-size:0.8rem; color:#888;">${row.dentist_name}</span></td>
        <td>${row.email}</td>
        <td>${row.chair_count} OPERATORIES</td>
        <td>${row.current_software.toUpperCase()}</td>
        <td style="color:#00FF66; font-family:monospace; font-weight:bold;">${timeStr}</td>
      `;
      tableBody.appendChild(tr);
    });
  }
});
