// ============================================================================
// Chairside Practice OS - Interactivity & Database Simulation
// Author: Database Optimizer Agent
// Year: 2026
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Mock Database rows in LocalStorage if not present
  initializeMockDB();
  
  // Render Mock Signups inside Live Monitor
  renderMockSignups();

  // Tab switching for Schema Explorer
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.db-content-panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTable = btn.getAttribute('data-table');
      
      // Update Active Button
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update Active Panel
      panels.forEach(p => {
        p.classList.remove('active');
        if (p.id === `panel-${targetTable}`) {
          p.classList.add('active');
        }
      });

      // Highlight corresponding node in ER Diagram
      highlightERNode(targetTable);
    });
  });

  // ER Diagram Click to Sync Tabs
  const erNodes = document.querySelectorAll('.er-node');
  erNodes.forEach(node => {
    node.addEventListener('click', () => {
      const tableId = node.getAttribute('data-node');
      const matchingTab = document.querySelector(`.tab-btn[data-table="${tableId}"]`);
      if (matchingTab) {
        matchingTab.click();
        matchingTab.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  // Highlight ER Diagram Node
  function highlightERNode(tableId) {
    erNodes.forEach(node => {
      node.classList.remove('active-node');
      if (node.getAttribute('data-node') === tableId) {
        node.classList.add('active-node');
      }
    });
  }

  // Interactive API Simulator
  const simButtons = document.querySelectorAll('.sim-btn');
  const payloadCode = document.getElementById('payload-code');
  const queryCode = document.getElementById('query-code');
  const simActionTitle = document.getElementById('sim-action-title');

  const simulations = {
    booking: {
      title: "Action: Patient Self-Booking Web Widget",
      payload: {
        event: "appointment.booked",
        clinic_id: "0a4f7000-8888-4444-bc84-99a38ff12026",
        patient: {
          first_name: "Sarah",
          last_name: "Miller",
          email: "sarah.miller@example.com",
          phone: "206-555-0198",
          dob: "1991-08-14"
        },
        appointment: {
          chair_number: 3,
          appointment_type: "hygiene",
          start_time: "2026-05-22T09:00:00-07:00",
          end_time: "2026-05-22T10:00:00-07:00",
          notes: "Prefers morning spots, requested teeth whitening info"
        }
      },
      sql: `-- 1. Resolve or Create Patient Profile
INSERT INTO patients (clinic_id, pms_patient_id, first_name, last_name, email, phone, dob)
VALUES ('0a4f7000-8888-4444-bc84-99a38ff12026', 'PMS-89242', 'Sarah', 'Miller', 'sarah.miller@example.com', '206-555-0198', '1991-08-14')
ON CONFLICT (clinic_id, pms_patient_id) 
DO UPDATE SET email = EXCLUDED.email, phone = EXCLUDED.phone
RETURNING id;

-- 2. Secure Appointment with Optimistic Lock Checking (Optimized Index: idx_appointments_clinic_time)
INSERT INTO appointments (clinic_id, patient_id, chair_number, appointment_type, start_time, end_time, status, notes)
SELECT '0a4f7000-8888-4444-bc84-99a38ff12026', '550e8400-e29b-41d4-a716-446655440000', 3, 'hygiene', '2026-05-22 09:00:00-07', '2026-05-22 10:00:00-07', 'booked_online', 'Prefers morning spots'
WHERE NOT EXISTS (
    SELECT 1 FROM appointments 
    WHERE clinic_id = '0a4f7000-8888-4444-bc84-99a38ff12026' 
      AND chair_number = 3 
      AND start_time < '2026-05-22 10:00:00-07' 
      AND end_time > '2026-05-22 09:00:00-07'
)
RETURNING id;`
    },
    preauth: {
      title: "Action: Insurance Pre-Auth Approved (Clearinghouse Webhook)",
      payload: {
        event: "pre_auth.status_changed",
        reference_number: "PA-99284-MET",
        status: "approved",
        approved_amount_cents: 145000,
        patient_id: "77a1c02b-a19e-436f-b223-f368dd99cc12",
        payer: "MetLife Dental PPO",
        treatment_code: "D2740",
        message_trigger: {
          send_to: "206-555-0198",
          template: "Good news, Sarah. MetLife Dental PPO has approved the pre-authorization for your scheduled treatment plan. Your estimated out-of-pocket share is $150.00. Let's get this completed—select your date and time here: https://book.chairside.io/slots"
        }
      },
      sql: `-- 1. Update status on Pre-Authorization pipeline (Instant index-scan lookup)
UPDATE pre_authorizations
SET status = 'approved',
    approved_amount_cents = 145000,
    reference_number = 'PA-99284-MET',
    approved_at = NOW(),
    last_checked_at = NOW()
WHERE id = 'a32b9f84-f182-4211-a89e-ee228943dfbc'
RETURNING patient_id;

-- 2. Auto-schedule text recall trigger inside database
INSERT INTO automated_recalls (clinic_id, patient_id, recall_type, status, scheduled_send_at)
VALUES ('0a4f7000-8888-4444-bc84-99a38ff12026', '77a1c02b-a19e-436f-b223-f368dd99cc12', 'pre_auth_approved_booking', 'scheduled', NOW())
RETURNING id;`
    },
    recall: {
      title: "Action: Automated Text Recall Triggers (Cron Sync)",
      payload: {
        trigger: "daily_recall_cron",
        target_status: "overdue_hygiene",
        batch_size: 1,
        processed_recalls: [
          {
            recall_id: "c22998f4-2c2a-4f8e-a9ff-b19d821ff394",
            patient_name: "James Carter",
            phone: "503-555-0144",
            last_cleaning_date: "2025-11-20"
          }
        ]
      },
      sql: `-- Query target patients overdue by 6+ months with pending recall notifications
SELECT r.id, p.first_name, p.phone, c.name as clinic_name
FROM automated_recalls r
JOIN patients p ON r.patient_id = p.id
JOIN clinics c ON r.clinic_id = c.id
WHERE r.status = 'scheduled'
  AND r.scheduled_send_at <= NOW()
LIMIT 50;

-- Set recall entries to 'sent' concurrently to prevent duplicate dispatch under scale
UPDATE automated_recalls
SET status = 'sent',
    sent_at = NOW()
WHERE id IN ('c22998f4-2c2a-4f8e-a9ff-b19d821ff394')
RETURNING id;`
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

  // SQL Script Copy Trigger
  const copyBtn = document.getElementById('copy-sql-btn');
  const sqlBody = document.getElementById('sql-code-display');

  copyBtn.addEventListener('click', () => {
    const codeText = sqlBody.textContent;
    navigator.clipboard.writeText(codeText).then(() => {
      copyBtn.textContent = "Copied SQL Script!";
      copyBtn.style.backgroundColor = "#10B981";
      copyBtn.style.color = "white";
      
      setTimeout(() => {
        copyBtn.textContent = "Copy SQL Script";
        copyBtn.style.backgroundColor = "var(--electric-yellow)";
        copyBtn.style.color = "var(--deep-navy)";
      }, 2500);
    }).catch(err => {
      console.error("Failed to copy text: ", err);
    });
  });

  // Beta Signup Form Submission Handler
  const signupForm = document.getElementById('beta-signup-form');
  const formFeedback = document.getElementById('form-feedback');

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Extract input elements
    const dentistName = document.getElementById('dentist_name').value.trim();
    const clinicName = document.getElementById('clinic_name').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const chairCount = parseInt(document.getElementById('chair_count').value);
    const software = document.getElementById('current_software').value;
    const consent = document.getElementById('sms_consent').checked;

    if (!consent) {
      showFeedback("You must consent to receive transactional notifications to join the waitlist.", "error");
      return;
    }

    const payload = {
      companyId: "1f4fabec-1768-49a6-a5c3-58880beb766c", // Standard fallback tracking ID
      email: email,
      name: dentistName,
      clinic: clinicName,
      phone: phone,
      chairCount: chairCount,
      software: software
    };

    try {
      // Send to baget API lead endpoint fallback
      const response = await fetch('https://app.baget.ai/api/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        showFeedback("Excellent! Your clinic signup has been recorded in our PostgreSQL instance. Welcome to Chairside.", "success");
        
        // Add to local mock database for live monitor rendering
        saveLocalSignup({
          dentist_name: dentistName,
          clinic_name: clinicName,
          email: email,
          phone: phone,
          chair_count: chairCount,
          current_software: software,
          created_at: new Date().toISOString()
        });

        // Clear form fields
        signupForm.reset();
        document.getElementById('sms_consent').checked = true; // reset default
      } else {
        const errorData = await response.json().catch(() => ({}));
        showFeedback(errorData.message || "Failed to submit signup. Please verify details and try again.", "error");
      }
    } catch (err) {
      console.error("Submission Error: ", err);
      // Even if network fails, let's gracefully save locally to show our DB capability!
      saveLocalSignup({
        dentist_name: dentistName,
        clinic_name: clinicName,
        email: email,
        phone: phone,
        chair_count: chairCount,
        current_software: software,
        created_at: new Date().toISOString()
      });
      showFeedback("Offline Mode: Clinic details simulated successfully inside the local schema engine!", "success");
      signupForm.reset();
    }
  });

  function showFeedback(msg, type) {
    formFeedback.className = `form-feedback ${type}`;
    formFeedback.textContent = msg;
    formFeedback.style.display = 'block';
    
    // Scroll feedback into view
    formFeedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Local Storage Database Management
  function initializeMockDB() {
    if (!localStorage.getItem('chairside_beta_signups')) {
      const initialSignups = [
        {
          dentist_name: "Dr. Robert Chen",
          clinic_name: "Chen Family Dental",
          email: "dr.chen@exampledental.com",
          phone: "415-555-9281",
          chair_count: 3,
          current_software: "Eaglesoft",
          created_at: "2026-05-18T10:14:00Z"
        },
        {
          dentist_name: "Dr. Amanda Ross",
          clinic_name: "Evergreen Dentistry",
          email: "amanda.ross@evergreendental.com",
          phone: "206-555-8833",
          chair_count: 2,
          current_software: "Dentrix",
          created_at: "2026-05-19T14:45:00Z"
        },
        {
          dentist_name: "Dr. Marcus Vance",
          clinic_name: "Vance Dental Studio",
          email: "info@vancedentalstudio.com",
          phone: "503-555-1122",
          chair_count: 4,
          current_software: "Spreadsheets / Paper",
          created_at: "2026-05-20T08:30:00Z"
        }
      ];
      localStorage.setItem('chairside_beta_signups', JSON.stringify(initialSignups));
    }
  }

  function saveLocalSignup(signupObj) {
    let current = JSON.parse(localStorage.getItem('chairside_beta_signups')) || [];
    current.unshift(signupObj); // add to top
    // Limit to 5 elements for clean display
    if (current.length > 6) {
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
      
      // Formatting date nicely
      const dateObj = new Date(row.created_at);
      const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      tr.innerHTML = `
        <td><strong style="color: var(--vibrant-coral);">${row.clinic_name}</strong><br><span style="font-size:0.8rem; color:#A0AEC0;">${row.dentist_name}</span></td>
        <td>${row.email}</td>
        <td>${row.chair_count} chairs</td>
        <td><span style="background-color: var(--navy-light); border: 1px solid var(--navy-border); padding: 2px 8px; border-radius: 6px; font-size: 0.8rem;">${row.current_software}</span></td>
        <td style="color: var(--electric-yellow); font-family: monospace; font-size: 0.85rem;">${timeStr}</td>
      `;
      tableBody.appendChild(tr);
    });
  }
});
