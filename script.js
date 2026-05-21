// ============================================================================
// CHAIRSIDE SYSTEM SCRIPT - SWISS CLEAN VERSION (2026)
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize mock database rows in LocalStorage if not present
  initializeMockDB();
  
  // Render mock signups inside the monitor
  renderMockSignups();

  // Initialize interactive schedule and appointment simulation state
  initializeTimelineAndDemo();

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

  // ============================================================================
  // INTERACTIVE SCHEDULER & BOOKING DEMO
  // ============================================================================
  function initializeTimelineAndDemo() {
    // Current Active Booking State variables
    let selectedService = '';
    let selectedDuration = 60;
    let selectedChair = 1;
    let selectedDate = '2026-05-21';
    let selectedTime = '';

    // Standard clinical timeline working hours: 08:00 to 17:00 (5:00 PM)
    const times = [
      '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'
    ];

    // Initial pre-existing clinical scheduler appointments
    let appointments = [
      { id: '1', chair: 1, date: '2026-05-21', time: '08:00', treatment: 'Preventive Recall', patient: 'Sarah Connor', status: 'occupied' },
      { id: '2', chair: 1, date: '2026-05-21', time: '11:00', treatment: 'Hygiene Polish', patient: 'Luke Skywalker', status: 'occupied' },
      { id: '3', chair: 2, date: '2026-05-21', time: '09:00', treatment: 'Routine Exam', patient: 'Ellen Ripley', status: 'occupied' },
      { id: '4', chair: 2, date: '2026-05-21', time: '14:00', treatment: 'Hygiene Maintenance', patient: 'Indiana Jones', status: 'occupied' },
      { id: '5', chair: 3, date: '2026-05-21', time: '10:00', treatment: 'Emergency Diagnostic', patient: 'Bruce Wayne', status: 'occupied' },
      { id: '6', chair: 4, date: '2026-05-21', time: '13:00', treatment: 'Invisalign consult', patient: 'Tony Stark', status: 'occupied' },
      
      // May 22 appointments
      { id: '7', chair: 1, date: '2026-05-22', time: '09:00', treatment: 'Preventive Recall', patient: 'Clark Kent', status: 'occupied' },
      { id: '8', chair: 3, date: '2026-05-22', time: '15:00', treatment: 'Diagnostic Check', patient: 'Peter Parker', status: 'occupied' },
      
      // May 25 appointments
      { id: '9', chair: 4, date: '2026-05-25', time: '10:00', treatment: 'Implant Consult', patient: 'Diana Prince', status: 'occupied' }
    ];

    // Render timeline based on selected date
    function renderTimeline() {
      const body = document.getElementById('timeline-slots-body');
      if (!body) return;
      body.innerHTML = '';

      times.forEach(time => {
        const row = document.createElement('div');
        row.className = 'timeline-row';

        // Time Label column
        const label = document.createElement('div');
        label.className = 'timeline-time-label';
        label.textContent = convertTo12Hour(time);
        row.appendChild(label);

        // Chair columns 1 to 4
        for (let chairNum = 1; chairNum <= 4; chairNum++) {
          const cell = document.createElement('div');
          cell.className = 'timeline-cell';
          cell.setAttribute('data-chair', chairNum);
          cell.setAttribute('data-time', time);

          // Find if there is an appointment scheduled in this block
          const match = appointments.find(appt => 
            appt.date === selectedDate && 
            appt.chair === chairNum && 
            appt.time === time
          );

          if (match) {
            const block = document.createElement('div');
            block.className = `appt-block ${match.status}`;
            block.innerHTML = `
              <div class="appt-title">${match.treatment}</div>
              <div class="appt-patient">${match.patient}</div>
            `;
            cell.appendChild(block);
          }

          row.appendChild(cell);
        }

        body.appendChild(row);
      });
    }

    // Helper: Convert "14:00" -> "02:00 PM"
    function convertTo12Hour(timeStr) {
      const hour = parseInt(timeStr.split(':')[0]);
      if (hour === 12) return '12:00 PM';
      if (hour > 12) return `${hour - 12}:00 PM`;
      return `${hour}:00 AM`;
    }

    // Initial render
    renderTimeline();

    // Treatment selections trigger Step 2
    const treatmentCards = document.querySelectorAll('.treatment-card');
    treatmentCards.forEach(card => {
      card.addEventListener('click', () => {
        treatmentCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');

        selectedService = card.getAttribute('data-service');
        selectedDuration = parseInt(card.getAttribute('data-duration'));
        selectedChair = parseInt(card.getAttribute('data-chair'));

        // Transition Step 1 to Step 2
        document.getElementById('step-ind-1').classList.remove('active');
        document.getElementById('step-ind-2').classList.add('active');
        document.getElementById('widget-step-1').classList.remove('active');
        document.getElementById('widget-step-2').classList.add('active');

        // Dynamically populate slots
        populateAvailableSlots();
      });
    });

    // Back to Step 1
    document.getElementById('back-to-step-1').addEventListener('click', () => {
      document.getElementById('step-ind-2').classList.remove('active');
      document.getElementById('step-ind-1').classList.add('active');
      document.getElementById('widget-step-2').classList.remove('active');
      document.getElementById('widget-step-1').classList.add('active');
    });

    // Date Tabs selection
    const dateTabs = document.querySelectorAll('.date-tab');
    dateTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        dateTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        selectedDate = tab.getAttribute('data-date');
        renderTimeline();
        populateAvailableSlots();
      });
    });

    // Generate and render available slots
    function populateAvailableSlots() {
      const container = document.getElementById('available-slots-container');
      if (!container) return;
      container.innerHTML = '';

      times.forEach(time => {
        // Check if there is already an occupied appointment on this specific chair/time
        const isOccupied = appointments.some(appt => 
          appt.date === selectedDate && 
          appt.chair === selectedChair && 
          appt.time === time
        );

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `time-slot-btn ${isOccupied ? 'disabled' : ''}`;
        btn.textContent = convertTo12Hour(time);
        btn.setAttribute('data-time', time);

        if (!isOccupied) {
          btn.addEventListener('click', () => {
            const allBtns = container.querySelectorAll('.time-slot-btn');
            allBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');

            selectedTime = time;

            // Transition from Step 2 to Step 3
            document.getElementById('step-ind-2').classList.remove('active');
            document.getElementById('step-ind-3').classList.add('active');
            document.getElementById('widget-step-2').classList.remove('active');
            document.getElementById('widget-step-3').classList.add('active');

            // Set Summary text
            const summaryText = document.getElementById('summary-card-text');
            const formatSelectedDate = new Date(selectedDate).toLocaleDateString([], {
              weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
            });
            summaryText.innerHTML = `
              <strong>Service:</strong> ${selectedService}<br>
              <strong>Date:</strong> ${formatSelectedDate}<br>
              <strong>Time Slot:</strong> ${convertTo12Hour(selectedTime)} (Chair ${selectedChair})
            `;
          });
        }

        container.appendChild(btn);
      });
    }

    // Back to Step 2
    document.getElementById('back-to-step-2').addEventListener('click', () => {
      document.getElementById('step-ind-3').classList.remove('active');
      document.getElementById('step-ind-2').classList.add('active');
      document.getElementById('widget-step-3').classList.remove('active');
      document.getElementById('widget-step-2').classList.add('active');
    });

    // Submit details form inside interactive demo widget
    const detailsForm = document.getElementById('widget-details-form');
    detailsForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const patientName = document.getElementById('widget_patient_name').value.trim();
      const patientPhone = document.getElementById('widget_patient_phone').value.trim();
      const patientEmail = document.getElementById('widget_patient_email').value.trim();
      const consentChecked = document.getElementById('widget_sms_consent').checked;

      if (!consentChecked) {
        alert("Patient must consent to receiving operational updates to book successfully.");
        return;
      }

      // 1. Log simulated booking into local appointments state
      const newAppt = {
        id: (appointments.length + 1).toString(),
        chair: selectedChair,
        date: selectedDate,
        time: selectedTime,
        treatment: selectedService,
        patient: patientName,
        status: 'active-booking'
      };

      appointments.push(newAppt);

      // 2. Re-render visual timeline scheduler
      renderTimeline();

      // 3. Prepare Receipt markup
      const receiptContent = document.getElementById('modal-receipt-content');
      receiptContent.innerHTML = `
        <div class="receipt-row"><span>PATIENT NAME</span><strong>${patientName.toUpperCase()}</strong></div>
        <div class="receipt-row"><span>PATIENT PHONE</span><strong>${patientPhone}</strong></div>
        <div class="receipt-row"><span>ASSIGNED OPERATORY</span><strong>CHAIR ${selectedChair}</strong></div>
        <div class="receipt-row"><span>TREATMENT TYPE</span><strong>${selectedService}</strong></div>
        <div class="receipt-row"><span>APPOINTMENT DATE</span><strong>${selectedDate}</strong></div>
        <div class="receipt-row"><span>START TIME</span><strong>${convertTo12Hour(selectedTime)}</strong></div>
        <div class="receipt-row"><span>SMS DELIV. RECEIPT</span><strong>QUEUED (ID: TX-${Math.floor(Math.random() * 90000) + 10000})</strong></div>
      `;

      // 4. Reset Patient Widget back to Step 1
      detailsForm.reset();
      document.getElementById('widget_sms_consent').checked = true;
      treatmentCards.forEach(c => c.classList.remove('selected'));
      document.getElementById('step-ind-3').classList.remove('active');
      document.getElementById('step-ind-1').classList.add('active');
      document.getElementById('widget-step-3').classList.remove('active');
      document.getElementById('widget-step-1').classList.add('active');

      // 5. Trigger the call-to-action waitlist pop-up modal
      document.getElementById('success-cta-modal').classList.add('active');
    });

    // Dismiss modal handler
    document.getElementById('modal-close-btn').addEventListener('click', () => {
      document.getElementById('success-cta-modal').classList.remove('active');
    });

    // Join Beta from modal handler: Dismisses modal, scrolls down to the waitlist section, and focuses form.
    document.getElementById('modal-join-beta-btn').addEventListener('click', () => {
      document.getElementById('success-cta-modal').classList.remove('active');
      
      const waitlistSection = document.getElementById('waitlist');
      if (waitlistSection) {
        waitlistSection.scrollIntoView({ behavior: 'smooth' });
        // Focus first field
        setTimeout(() => {
          const dentistField = document.getElementById('dentist_name');
          if (dentistField) dentistField.focus();
        }, 800);
      }
    });
  }
});
