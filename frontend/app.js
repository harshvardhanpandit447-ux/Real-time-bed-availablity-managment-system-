// Mediloc — Smart Hospital Finder & Real-Time Bed Availability System
// Multi-Hospital Role-Based Security & Two-Portal Architecture
const $ = id => document.getElementById(id);

let currentUser = null;
let currentStaffProfile = null;
let currentPortal = null; // 'user' or 'hospital'
let hospitals = [];
let staffBeds = [];
let heroMap = null;
let listMap = null;
let heroMarkers = [];
let listMarkers = [];
let userLocationMarkerHero = null;
let userLocationMarkerList = null;
let scanner = null;
let selectedHospitalId = null;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3500);
}

function message(msg, type = "") {
  const el = $("scanMessage");
  if (el) {
    el.textContent = msg;
    el.className = "message " + type;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

// ---------------------------------------------------------
// Maps & Markers Synchronization
// ---------------------------------------------------------

function initMap(id) {
  if (!window.L) return null;
  const map = L.map(id, { scrollWheelZoom: false }).setView([18.5204, 73.8567], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  return map;
}

function markerColor(h) {
  if (h.available_beds === 0) return "#dc2626"; // Full
  if (h.available_beds <= 3) return "#d97706"; // Limited
  return "#16a34a"; // Available
}

function drawMarkers(map, markersList) {
  if (!map || !window.L) return;
  markersList.forEach(m => m.remove());
  markersList.length = 0;

  hospitals.forEach(h => {
    const marker = L.circleMarker([h.latitude, h.longitude], {
      radius: 9,
      fillColor: markerColor(h),
      color: "#ffffff",
      weight: 3,
      fillOpacity: 1
    }).addTo(map);

    const distInfo = h.distance_km != null ? `<br><small style="color:#2563eb;font-weight:700">📍 ${h.distance_km} km away</small>` : '';

    marker.bindPopup(`
      <div style="min-width:180px;font-family:inherit">
        <b style="color:#0d2850;font-size:13px">${esc(h.name)}</b>
        <div style="font-size:11px;color:#64748b;margin:3px 0 6px">${esc(h.address)}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
          <span style="font-size:11px;font-weight:700;color:${markerColor(h)}">${h.available_beds} beds available</span>
          <button style="border:0;background:#2563eb;color:#fff;border-radius:6px;padding:3px 8px;font-size:10px;cursor:pointer" onclick="openHospitalDetails(${h.id})">Details →</button>
        </div>
        ${distInfo}
      </div>
    `);

    marker.on("click", () => {
      openHospitalDetails(h.id);
    });

    markersList.push(marker);
  });
}

function updateUserLocationMarker(lat, lng, localityName = "Your Saved Location") {
  if (!lat || !lng || !window.L) return;
  const coords = [lat, lng];

  [heroMap, listMap].forEach(m => {
    if (!m) return;
    const userIcon = L.divIcon({
      className: 'user-loc-pin',
      html: `<div style="background:#2563eb;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,0.4)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
    const marker = L.marker(coords, { icon: userIcon }).addTo(m);
    marker.bindPopup(`<b>📍 ${esc(localityName)}</b><br><small>Your saved primary location</small>`);
  });

  if (heroMap) heroMap.setView(coords, 13);
  if (listMap) listMap.setView(coords, 13);
}

// ---------------------------------------------------------
// Hospital Directory & Discovery (Public Read-Only)
// ---------------------------------------------------------

function renderStats() {
  $("statHospitals").textContent = hospitals.length;
  $("statAvailable").textContent = hospitals.reduce((a, h) => a + (h.available_beds || 0), 0);
  $("statOccupied").textContent = hospitals.reduce((a, h) => a + (h.occupied_beds || 0), 0);
  $("statCleaning").textContent = hospitals.reduce((a, h) => a + (h.cleaning_beds || 0), 0);
}

function renderHospitals() {
  const listEl = $("hospitalList");
  if (!hospitals.length) {
    listEl.innerHTML = `
      <div style="padding:28px;text-align:center;background:#fff;border-radius:14px;border:1px solid #e2e8f0;">
        <span style="font-size:26px">🏥</span>
        <h4 style="margin:8px 0 4px;color:#0d2850">No hospitals matched your search</h4>
        <p style="font-size:12px;color:#64748b;margin:0">Try searching for a different locality in Pune (e.g., Baner, Shivajinagar, Deccan).</p>
      </div>`;
    return;
  }

  listEl.innerHTML = hospitals.map(h => {
    const level = h.available_beds === 0 ? "full" : (h.available_beds <= 3 ? "limited" : "available");
    const isSelected = selectedHospitalId === h.id ? "selected" : "";
    const distChip = h.distance_km != null
      ? `<span class="distance-badge">📍 ${h.distance_km} km away</span>`
      : '';

    return `
      <article class="hospital-card ${isSelected}" id="hospital-${h.id}" onclick="openHospitalDetails(${h.id})">
        <div class="hospital-card-head">
          <h3>${esc(h.name)}</h3>
          <span class="bed-pill ${level}">${h.available_beds} Available</span>
        </div>
        <p>📍 ${esc(h.address)}</p>
        <div class="mini-metrics">
          <span>▦ <b>${h.total_beds}</b> total beds</span>
          <span>＋ <b>${h.icu_available}</b> ICU available</span>
          <span>◷ <b>${h.cleaning_beds}</b> cleaning</span>
          ${distChip}
        </div>
        <div class="hospital-card-actions" onclick="event.stopPropagation()">
          <button class="btn btn-primary btn-small" onclick="openHospitalDetails(${h.id})">View Details & Wards →</button>
          <button class="btn btn-outline btn-small" onclick="focusHospitalMap(${h.id})">Center on Map</button>
          <a class="btn btn-outline btn-small" href="tel:${esc(h.phone)}">📞 Call</a>
        </div>
      </article>`;
  }).join("");
}

async function loadHospitals(params = {}) {
  let queryParts = [];
  if (currentUser && currentUser.latitude && currentUser.longitude) {
    queryParts.push(`lat=${currentUser.latitude}&lng=${currentUser.longitude}&sort=distance`);
  } else if (params.lat && params.lng) {
    queryParts.push(`lat=${params.lat}&lng=${params.lng}&sort=distance`);
  }

  if (params.search) queryParts.push(`search=${encodeURIComponent(params.search)}`);
  if (params.sort) queryParts.push(`sort=${encodeURIComponent(params.sort)}`);
  if (params.available_only) queryParts.push(`available_only=1`);
  if (params.icu_only) queryParts.push(`icu_only=1`);

  const url = "/api/hospitals" + (queryParts.length ? "?" + queryParts.join("&") : "");
  try {
    hospitals = await api(url);
    renderStats();
    renderHospitals();
    drawMarkers(heroMap, heroMarkers);
    drawMarkers(listMap, listMarkers);
  } catch (e) {
    toast(`Failed to load hospitals: ${e.message}`);
  }
}

function focusHospitalMap(id) {
  const h = hospitals.find(x => x.id === id);
  if (!h) return;
  selectedHospitalId = id;
  [heroMap, listMap].forEach(m => {
    if (m) m.setView([h.latitude, h.longitude], 15);
  });
  renderHospitals();
}

window.openHospitalDetails = async function(hospitalId) {
  selectedHospitalId = hospitalId;
  renderHospitals();
  try {
    let url = `/api/hospitals/${hospitalId}`;
    if (currentUser && currentUser.latitude && currentUser.longitude) {
      url += `?lat=${currentUser.latitude}&lng=${currentUser.longitude}`;
    }
    const h = await api(url);

    $("detailHospitalName").textContent = h.name;
    $("detailHospitalAddress").textContent = `📍 ${h.address}`;
    $("detailDemoBadge").textContent = h.is_demo ? "VERIFIED DEMO RECORD · PUNE NETWORK" : "OPERATIONAL HEALTHCARE FACILITY";
    $("detailTotalBeds").textContent = h.total_beds;
    $("detailAvailableBeds").textContent = h.available_beds;
    $("detailOccupiedBeds").textContent = h.occupied_beds;
    $("detailCleaningBeds").textContent = h.cleaning_beds;
    $("detailIcuBeds").textContent = h.icu_available;
    $("detailGeneralBeds").textContent = h.general_available;

    if (h.distance_km != null) {
      $("detailDistanceBadge").textContent = `📍 ${h.distance_km} km from your saved location`;
      $("detailDistanceBadge").style.display = "inline-flex";
    } else {
      $("detailDistanceBadge").textContent = `📍 Located in ${h.locality || h.city || "Pune"}`;
      $("detailDistanceBadge").style.display = "inline-flex";
    }

    $("detailLastUpdated").textContent = h.updated_at
      ? `◷ Status updated: ${new Date(h.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : "◷ Real-time status active";

    $("detailCallBtn").href = `tel:${h.phone || '+919823011001'}`;
    $("detailCenterMapBtn").onclick = () => {
      focusHospitalMap(h.id);
      closeHospitalModal();
      toast(`Focused map on ${h.name}`);
    };

    const wardContainer = $("detailWardList");
    if (h.wards && h.wards.length) {
      wardContainer.innerHTML = h.wards.map(w => {
        const wardBeds = (h.beds || []).filter(b => b.ward === w.name);
        return `
          <div class="ward-card">
            <div class="ward-card-head">
              <div>
                <b>${esc(w.name)}</b>
                <span class="bed-pill ${w.category === 'ICU' ? 'limited' : 'available'}" style="margin-left:6px">${esc(w.category)} Ward</span>
              </div>
              <small><b>${w.available}</b> available / ${w.total} total</small>
            </div>
            <div class="ward-beds-grid">
              ${wardBeds.map(b => `
                <div class="bed-item ${b.status.toLowerCase()}" title="${b.label}: ${b.status}">
                  <b>${esc(b.label)}</b>
                  <small>${esc(b.status)}</small>
                </div>
              `).join("")}
            </div>
          </div>`;
      }).join("");
    } else {
      wardContainer.innerHTML = `<div class="notif-empty">No bed breakdown available for this facility.</div>`;
    }

    $("hospitalDetailModal").style.display = "grid";
  } catch (e) {
    toast(`Could not load hospital details: ${e.message}`);
  }
};

function closeHospitalModal() {
  $("hospitalDetailModal").style.display = "none";
}

// ---------------------------------------------------------
// Location Search & GPS
// ---------------------------------------------------------

async function searchLocation() {
  const query = $("locationInput").value.trim();
  if (!query) {
    toast("Please enter a locality or area.");
    return;
  }
  $("mapSubheading").textContent = `Showing Pune hospitals matching "${query}"`;
  await loadHospitals({ search: query });
  toast(`Searched hospitals for: "${query}"`);
}

window.quickSearch = function(loc) {
  $("locationInput").value = loc;
  searchLocation();
};

function useGps() {
  if (!navigator.geolocation) {
    toast("Geolocation is not supported by your browser.");
    return;
  }
  toast("Locating your coordinates...");
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      updateUserLocationMarker(lat, lng, "Your Current GPS Location");
      loadHospitals({ lat, lng });
      $("mapSubheading").textContent = "Map centered on your current GPS location";
      toast("Map centered and hospitals sorted by GPS distance.");
    },
    err => {
      toast(err.code === 1 ? "Location permission denied." : "Could not determine GPS location.");
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// ---------------------------------------------------------
// Authentication State & Two-Portal Architecture
// ---------------------------------------------------------

async function checkAuthSession() {
  try {
    const res = await api("/api/auth/me");
    if (res.authenticated && res.user) {
      applyAuthState(res.user, res.staff_profile, res.portal);
    } else {
      applyGuestState();
    }
  } catch {
    applyGuestState();
  }
}

function applyAuthState(user, staffProfile = null, portal = "user") {
  currentUser = user;
  currentStaffProfile = staffProfile;
  currentPortal = portal;

  $("authGuestControls").style.display = "none";
  $("authUserControls").style.display = "flex";
  $("navUserName").textContent = user.name.split(" ")[0];
  $("navUserAvatar").textContent = user.name.charAt(0).toUpperCase();

  if (user.role === "staff" || user.role === "admin") {
    // Hospital Portal Mode
    const hospName = staffProfile ? staffProfile.hospital_name : "All Facilities (Admin)";
    $("navUserBadge").textContent = `🏥 ${hospName.split(" ")[0]} Staff`;

    // Staff section reflects locked assignment
    $("staffAuthRequiredBanner").style.display = "none";
    $("staffDashboardContainer").style.display = "block";

    $("staffRoleBadge").textContent = user.role.toUpperCase();
    $("staffLockedHospTitle").textContent = hospName;
    $("staffLockedHospAddress").textContent = staffProfile ? `${staffProfile.role_title} · Assigned facility access` : "System Administrator Oversight";

    $("bedHospitalLabel").textContent = `${hospName} Bed Inventory`;
    $("bedHospitalSublabel").textContent = `Operational access strictly restricted to ${hospName}`;

    // Load hospital-specific records
    loadStaffBeds();
    loadCleaningQueue();
    loadAuditLogs();
  } else {
    // Citizen Portal Mode
    $("navUserBadge").textContent = `📍 ${user.locality || user.city || "Pune"}`;

    // Show saved location banner in Hero
    const banner = $("userLocationBanner");
    banner.style.display = "flex";
    $("bannerLocalityText").textContent = `Showing hospitals near your saved locality (${user.locality || user.city})`;
    $("bannerAddressText").textContent = `${user.address ? user.address + ' · ' : ''}${user.city} ${user.pincode ? '· PIN ' + user.pincode : ''}`;

    if (user.latitude && user.longitude) {
      updateUserLocationMarker(user.latitude, user.longitude, user.locality || user.city);
    }

    // Public user visiting staff section gets clear security notice
    $("staffAuthRequiredBanner").style.display = "flex";
    $("staffDashboardContainer").style.display = "none";
    $("staffLockedHospTitle").textContent = "Hospital Staff Portal Restricted";
    $("staffLockedHospAddress").textContent = "Public citizen accounts have read-only access";
  }

  loadHospitals();
}

function applyGuestState() {
  currentUser = null;
  currentStaffProfile = null;
  currentPortal = null;

  $("authGuestControls").style.display = "flex";
  $("authUserControls").style.display = "none";
  $("userLocationBanner").style.display = "none";

  // Staff section shows login required banner
  $("staffAuthRequiredBanner").style.display = "flex";
  $("staffDashboardContainer").style.display = "none";
  $("staffLockedHospTitle").textContent = "Sign in to Hospital Portal";
  $("staffLockedHospAddress").textContent = "Operations strictly locked to assigned facility";

  loadHospitals();
}

// ---------------------------------------------------------
// Hospital Staff Bed Management (Isolated to Assigned Facility)
// ---------------------------------------------------------

async function loadStaffBeds() {
  try {
    staffBeds = await api("/api/staff/beds");
    renderStaffBeds();
  } catch (e) {
    console.error("Load staff beds error:", e);
  }
}

function renderStaffBeds() {
  const cat = $("bedCategoryFilter").value;
  const status = $("bedStatusFilter").value;

  let filtered = staffBeds;
  if (cat) filtered = filtered.filter(b => b.category === cat);
  if (status) filtered = filtered.filter(b => b.status === status);

  const grid = $("bedGrid");
  if (!filtered.length) {
    grid.innerHTML = `<p style="padding:16px;color:#64748b">No beds match the selected filters.</p>`;
    return;
  }

  grid.innerHTML = filtered.map(b => `
    <button class="bed-item ${b.status.toLowerCase()}" data-bed="${b.id}" onclick="selectBed(${b.id})">
      <b>${esc(b.label)}</b>
      <small>${esc(b.category)} · ${esc(b.status)}</small>
    </button>
  `).join("");

  $("bedSelect").innerHTML = filtered.map(b => `
    <option value="${b.id}">${esc(b.label)} (${esc(b.ward)}) — ${esc(b.status)}</option>
  `).join("");
}

window.selectBed = function(bedId) {
  $("bedSelect").value = String(bedId);
  const b = staffBeds.find(x => x.id === bedId);
  if (b) {
    if (b.status === "Available") $("actionSelect").value = "admit";
    else if (b.status === "Occupied") $("actionSelect").value = "discharge";
    else if (b.status === "Cleaning") $("actionSelect").value = "clean";
    toast(`Selected ${b.label} (${b.status})`);
  }
};

async function runBedAction(bedId, action, patientCode = "") {
  let endpoint = `/api/beds/${bedId}/`;
  if (action === "admit") endpoint += "admit";
  else if (action === "discharge") endpoint += "discharge";
  else if (action === "clean") endpoint += "confirm-clean";

  const res = await api(endpoint, {
    method: "POST",
    body: JSON.stringify({ patient_code: patientCode })
  });

  await refreshAll();
  await loadStaffBeds();
  loadCleaningQueue();
  loadAuditLogs();
  toast(`Bed ${res.label} status updated to: ${res.status}`);
  return res;
}

// ---------------------------------------------------------
// Cleaning Queue Management (Assigned Facility)
// ---------------------------------------------------------

async function loadCleaningQueue() {
  const listEl = $("cleaningQueueList");
  try {
    const records = await api("/api/staff/cleaning-queue");
    if (!records.length) {
      listEl.innerHTML = `<div class="notif-empty">No beds currently awaiting sanitization in your facility.</div>`;
      return;
    }
    listEl.innerHTML = records.map(r => `
      <div class="cleaning-card">
        <div class="cleaning-info">
          <b>${esc(r.bed_label)} · ${esc(r.ward)}</b>
          <small>Status: <span class="bed-pill ${r.status === 'Completed' ? 'available' : 'limited'}">${esc(r.status)}</span> · Requested: ${new Date(r.requested_at).toLocaleTimeString()}</small>
        </div>
        <div class="cleaning-actions">
          ${r.status === 'Pending' ? `
            <button class="btn btn-outline btn-tiny" onclick="updateCleaningStep(${r.bed_id}, 'In Progress')">Start Sanitizing</button>
          ` : ''}
          ${r.status === 'In Progress' ? `
            <button class="btn btn-primary btn-tiny" onclick="updateCleaningStep(${r.bed_id}, 'Completed')">Mark Completed</button>
          ` : ''}
          ${r.status === 'Completed' ? `
            <button class="btn btn-primary btn-tiny" onclick="confirmReleaseBed(${r.bed_id})">Release Bed (Available)</button>
          ` : ''}
        </div>
      </div>
    `).join("");
  } catch (e) {
    listEl.innerHTML = `<div class="message error">Failed to load cleaning queue: ${e.message}</div>`;
  }
}

window.updateCleaningStep = async function(bedId, status) {
  try {
    await api(`/api/beds/${bedId}/cleaning-status`, {
      method: "POST",
      body: JSON.stringify({ status })
    });
    toast(`Cleaning status set to "${status}"`);
    loadCleaningQueue();
    loadAuditLogs();
  } catch (e) {
    toast(`Error: ${e.message}`);
  }
};

window.confirmReleaseBed = async function(bedId) {
  try {
    await api(`/api/beds/${bedId}/confirm-clean`, { method: "POST" });
    toast("Bed sanitized and released to Available!");
    await refreshAll();
    await loadStaffBeds();
    loadCleaningQueue();
    loadAuditLogs();
  } catch (e) {
    toast(`Error: ${e.message}`);
  }
};

// ---------------------------------------------------------
// Audit Trail & Notifications
// ---------------------------------------------------------

async function loadAuditLogs() {
  const listEl = $("auditLogList");
  try {
    const logs = await api("/api/staff/audit-logs");
    if (!logs.length) {
      listEl.innerHTML = `<div class="notif-empty">No audit events recorded for this facility.</div>`;
      return;
    }
    listEl.innerHTML = logs.map(l => `
      <div class="audit-card">
        <div>
          <b>${esc(l.details || l.action)}</b>
          <small>By: ${esc(l.actor_name)} (${esc(l.actor_role)}) · ${new Date(l.timestamp).toLocaleTimeString()}</small>
        </div>
        <span class="badge">${esc(l.action)}</span>
      </div>
    `).join("");
  } catch (e) {
    listEl.innerHTML = `<div class="message error">Failed to load audit logs: ${e.message}</div>`;
  }
}

async function loadNotifications() {
  try {
    const notifs = await api("/api/notifications");
    const badge = $("notifBadge");
    const list = $("notifList");
    const countLabel = $("notifCountLabel");

    if (notifs.length) {
      badge.textContent = notifs.length;
      badge.style.display = "inline-block";
      countLabel.textContent = `${notifs.length} updates`;
      list.innerHTML = notifs.map(n => `
        <div class="notif-item">
          <b>${esc(n.title)}</b>
          <div>${esc(n.message)}</div>
          <small>${new Date(n.created_at).toLocaleTimeString()}</small>
        </div>
      `).join("");
    } else {
      badge.style.display = "none";
      list.innerHTML = `<div class="notif-empty">No new notifications</div>`;
    }
  } catch (e) {
    console.warn("Notifications load error:", e);
  }
}

// ---------------------------------------------------------
// QR Scanner & Generator (Hospital Isolated)
// ---------------------------------------------------------

async function makeQr() {
  const bedId = Number($("bedSelect").value);
  if (!bedId) {
    toast("Please select a bed first.");
    return;
  }
  try {
    const qrData = await api(`/api/beds/${bedId}/qr`, { method: "POST" });
    const w = window.open("", "_blank", "width=420,height=520");
    if (!w) {
      toast("Allow pop-ups to view bed QR.");
      return;
    }
    w.document.write(`
      <!doctype html><html><head><title>Mediloc Bed QR</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        body{font-family:system-ui,sans-serif;text-align:center;padding:24px;color:#0f172a}
        #qrcode{margin:20px auto;display:inline-block}
        .tag{background:#eff6ff;color:#1e40af;padding:8px 12px;border-radius:8px;font-family:monospace;margin:12px 0}
      </style></head><body>
        <h2>Mediloc Bed QR Identifier</h2>
        <p><b>${esc(qrData.hospital_name)}</b><br>${esc(qrData.ward)} · ${esc(qrData.label)}</p>
        <div id="qrcode"></div>
        <p class="tag">${qrData.qr_payload}</p>
        <small>Only authorized staff of ${esc(qrData.hospital_name)} can perform status changes.</small>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
        <script>new QRCode(document.getElementById('qrcode'),{text:${JSON.stringify(qrData.qr_payload)},width:230,height:230});<\/script>
      </body></html>`);
    w.document.close();
  } catch (e) {
    toast(`QR Generation Error: ${e.message}`);
  }
}

async function handleScan(decodedText) {
  await stopScanner();
  try {
    const scanRes = await api("/api/demo/scan", {
      method: "POST",
      body: JSON.stringify({ qr_payload: decodedText })
    });

    const b = scanRes.bed;
    selectBed(b.id);
    const humanAction = b.status === "Available" ? "Admit Patient" : (b.status === "Occupied" ? "Discharge Patient" : "Confirm Cleaning");

    if (confirm(`Scanned ${b.label} (${b.status}). Proceed with ${humanAction}?`)) {
      await runBedAction(b.id, scanRes.next_action, $("patientCode").value.trim());
      message(`QR Scan Success: ${b.label} updated to ${b.status}.`, "success");
    } else {
      message("Scan recognized; action canceled by staff.", "info");
    }
  } catch (e) {
    message(`Scan error: ${e.message}`, "error");
  }
}

async function startScanner() {
  if (!window.Html5Qrcode) {
    message("QR scanner library loading error. Check connection.", "error");
    return;
  }
  try {
    scanner = new Html5Qrcode("qr-reader");
    $("startScanBtn").disabled = true;
    $("stopScanBtn").disabled = false;
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      text => handleScan(text),
      () => {}
    );
    message("Camera active. Point at a Mediloc Bed QR code.");
  } catch (e) {
    $("startScanBtn").disabled = false;
    $("stopScanBtn").disabled = true;
    scanner = null;
    message(`Could not start camera: ${e}. Ensure HTTPS or localhost is active.`, "error");
  }
}

async function stopScanner() {
  if (scanner) {
    try {
      if (scanner.isScanning) await scanner.stop();
      await scanner.clear();
    } catch {}
    scanner = null;
  }
  $("startScanBtn").disabled = false;
  $("stopScanBtn").disabled = true;
}

async function refreshAll() {
  try {
    await loadHospitals();
    loadNotifications();
  } catch (e) {
    console.error("Refresh error:", e);
  }
}

// ---------------------------------------------------------
// Quick Fill Helpers
// ---------------------------------------------------------

window.fillRegLoc = function(locality, pin) {
  $("regLocality").value = locality;
  $("regPincode").value = pin;
};

window.quickFillUserLogin = function(email, pwd) {
  $("userLoginEmail").value = email;
  $("userLoginPassword").value = pwd;
};

window.quickFillHospitalLogin = function(email, pwd) {
  $("hospitalLoginEmail").value = email;
  $("hospitalLoginPassword").value = pwd;
};

// ---------------------------------------------------------
// DOM Event Listeners & Initialization
// ---------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  // Mobile Nav Toggle
  $("menuToggle").addEventListener("click", () => $("mainNav").classList.toggle("open"));
  document.querySelectorAll("#mainNav a").forEach(a => {
    a.addEventListener("click", () => $("mainNav").classList.remove("open"));
  });

  // Initialize Leaflet Maps
  heroMap = initMap("heroMap");
  listMap = initMap("listMap");

  // Check authenticated session
  await checkAuthSession();
  await refreshAll();

  // Route check for direct URL access (e.g., /login/user or /login/hospital)
  if (window.location.pathname === "/login/user") {
    $("userLoginModal").style.display = "grid";
  } else if (window.location.pathname === "/login/hospital") {
    $("hospitalLoginModal").style.display = "grid";
  }

  // Search & Filters
  $("searchBtn").addEventListener("click", searchLocation);
  $("locationInput").addEventListener("keydown", e => { if (e.key === "Enter") searchLocation(); });
  $("gpsBtn").addEventListener("click", useGps);
  $("refreshBtn").addEventListener("click", () => { refreshAll(); toast("Hospital statuses refreshed."); });

  $("sortFilter").addEventListener("change", e => {
    loadHospitals({ sort: e.target.value });
  });
  $("filterAvailableOnly").addEventListener("change", e => {
    loadHospitals({ available_only: e.target.checked });
  });
  $("filterIcuOnly").addEventListener("change", e => {
    loadHospitals({ icu_only: e.target.checked });
  });

  // Staff Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.style.display = "none");
      btn.classList.add("active");
      const target = $(btn.dataset.tab);
      if (target) target.style.display = "block";
      if (btn.dataset.tab === "tabCleaning") loadCleaningQueue();
      if (btn.dataset.tab === "tabAudit") loadAuditLogs();
    });
  });

  // Staff Controls
  $("loadBedsBtn").addEventListener("click", loadStaffBeds);
  $("bedCategoryFilter").addEventListener("change", renderStaffBeds);
  $("bedStatusFilter").addEventListener("change", renderStaffBeds);
  $("refreshCleaningBtn").addEventListener("click", loadCleaningQueue);
  $("refreshAuditBtn").addEventListener("click", loadAuditLogs);

  $("runActionBtn").addEventListener("click", async () => {
    const id = Number($("bedSelect").value);
    const action = $("actionSelect").value;
    const pCode = $("patientCode").value.trim();
    if (!id) { toast("Please select a bed first."); return; }
    try {
      await runBedAction(id, action, pCode);
    } catch (e) {
      toast(`Action error: ${e.message}`);
    }
  });

  $("generateQrBtn").addEventListener("click", makeQr);
  $("startScanBtn").addEventListener("click", startScanner);
  $("stopScanBtn").addEventListener("click", stopScanner);

  $("qrFile").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file || !window.Html5Qrcode) return;
    const reader = new Html5Qrcode("qr-reader");
    try {
      const decoded = await reader.scanFile(file, true);
      await handleScan(decoded);
    } catch (err) {
      message("Could not read QR code from file.", "error");
    }
    e.target.value = "";
  });

  // Modal Triggers
  $("closeDetailModalBtn").addEventListener("click", closeHospitalModal);
  $("closeDetailFooterBtn").addEventListener("click", closeHospitalModal);

  // Two-Portal Modal Openers
  $("openUserLoginBtn").addEventListener("click", () => {
    $("userLoginError").style.display = "none";
    $("userLoginModal").style.display = "grid";
  });
  $("closeUserLoginModalBtn").addEventListener("click", () => $("userLoginModal").style.display = "none");

  $("openHospitalLoginBtn").addEventListener("click", () => {
    $("hospitalLoginError").style.display = "none";
    $("hospitalLoginModal").style.display = "grid";
  });
  $("promptStaffLoginBtn").addEventListener("click", () => {
    $("hospitalLoginError").style.display = "none";
    $("hospitalLoginModal").style.display = "grid";
  });
  $("closeHospitalLoginModalBtn").addEventListener("click", () => $("hospitalLoginModal").style.display = "none");

  $("openRegisterBtn").addEventListener("click", () => {
    $("regError").style.display = "none";
    $("registerModal").style.display = "grid";
  });
  $("closeRegisterModalBtn").addEventListener("click", () => $("registerModal").style.display = "none");

  $("switchToUserLoginLink").addEventListener("click", e => {
    e.preventDefault();
    $("registerModal").style.display = "none";
    $("userLoginModal").style.display = "grid";
  });
  $("switchToRegisterFromUserLink").addEventListener("click", e => {
    e.preventDefault();
    $("userLoginModal").style.display = "none";
    $("registerModal").style.display = "grid";
  });

  // Profile Modal
  $("openProfileBtn").addEventListener("click", () => {
    if (!currentUser) return;
    $("profName").value = currentUser.name;
    $("profEmail").value = currentUser.email;
    $("profCity").value = currentUser.city || "Pune";
    $("profLocality").value = currentUser.locality || "";
    $("profPincode").value = currentUser.pincode || "";
    $("profAddress").value = currentUser.address || "";
    $("profCoordsLabel").textContent = `Coordinates: ${currentUser.latitude ? currentUser.latitude.toFixed(4) + ', ' + currentUser.longitude.toFixed(4) : 'Pending'}`;
    $("profError").style.display = "none";
    $("profSuccess").style.display = "none";
    $("profileModal").style.display = "grid";
  });
  $("closeProfileModalBtn").addEventListener("click", () => $("profileModal").style.display = "none");
  $("bannerEditLocBtn").addEventListener("click", () => $("openProfileBtn").click());

  // Logout
  $("logoutBtn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    applyGuestState();
    toast("Signed out successfully.");
  });

  // Citizen Registration Form Submit
  $("registerForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = $("regError");
    errEl.style.display = "none";

    const payload = {
      name: $("regName").value.trim(),
      email: $("regEmail").value.trim(),
      password: $("regPassword").value,
      confirm_password: $("regConfirmPassword").value,
      city: $("regCity").value.trim(),
      locality: $("regLocality").value.trim(),
      pincode: $("regPincode").value.trim(),
      address: $("regAddress").value.trim()
    };

    try {
      const res = await api("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
      $("registerModal").style.display = "none";
      applyAuthState(res.user, null, "user");
      toast(`Welcome, ${res.user.name}! Your citizen profile in ${res.user.locality} is registered.`);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = "block";
    }
  });

  // Option A: Citizen Login Form Submit
  $("userLoginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = $("userLoginError");
    errEl.style.display = "none";

    const payload = {
      email: $("userLoginEmail").value.trim(),
      password: $("userLoginPassword").value
    };

    try {
      const res = await api("/api/auth/login/user", { method: "POST", body: JSON.stringify(payload) });
      $("userLoginModal").style.display = "none";
      applyAuthState(res.user, null, "user");
      toast(`Signed in as ${res.user.name}. Nearby hospitals sorted by distance.`);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = "block";
    }
  });

  // Option B: Hospital Staff Login Form Submit
  $("hospitalLoginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = $("hospitalLoginError");
    errEl.style.display = "none";

    const payload = {
      email: $("hospitalLoginEmail").value.trim(),
      password: $("hospitalLoginPassword").value
    };

    try {
      const res = await api("/api/auth/login/hospital", { method: "POST", body: JSON.stringify(payload) });
      $("hospitalLoginModal").style.display = "none";
      applyAuthState(res.user, res.staff_profile, "hospital");
      toast(`Hospital Staff Authenticated: ${res.staff_profile.hospital_name}.`);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = "block";
    }
  });

  // Profile Form Submit
  $("profileForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = $("profError");
    const succEl = $("profSuccess");
    errEl.style.display = "none";
    succEl.style.display = "none";

    const payload = {
      name: $("profName").value.trim(),
      city: $("profCity").value.trim(),
      locality: $("profLocality").value.trim(),
      pincode: $("profPincode").value.trim(),
      address: $("profAddress").value.trim()
    };

    try {
      const res = await api("/api/auth/profile", { method: "PUT", body: JSON.stringify(payload) });
      succEl.textContent = "Profile and location updated successfully.";
      succEl.style.display = "block";
      setTimeout(() => { $("profileModal").style.display = "none"; }, 900);
      applyAuthState(res.user, currentStaffProfile, currentPortal);
      toast("Location updated! Discovery refreshed.");
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = "block";
    }
  });

  // Notification Toggle
  $("notifBtn").addEventListener("click", () => {
    const d = $("notifDropdown");
    d.style.display = d.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("click", e => {
    if (!$("notifBtn").contains(e.target) && !$("notifDropdown").contains(e.target)) {
      $("notifDropdown").style.display = "none";
    }
  });

  // Contact Form Submit
  $("contactForm").addEventListener("submit", e => {
    e.preventDefault();
    $("contactMsg").textContent = "Inquiry registered. Our coordination team will follow up via email.";
    toast("Thank you! Your message has been received.");
    $("contactForm").reset();
  });

  // Periodic Polling
  setInterval(() => {
    if (!document.hidden) refreshAll();
  }, 25000);
});
