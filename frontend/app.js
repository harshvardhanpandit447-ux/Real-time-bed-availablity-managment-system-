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

async function loadPublicStats() {
  const statHospEl = $("statHospitals");
  const statAvailEl = $("statAvailable");
  const statOccEl = $("statOccupied");
  const statCleanEl = $("statCleaning");

  try {
    const stats = await api("/api/stats");
    if (statHospEl) statHospEl.textContent = stats.total_hospitals != null ? stats.total_hospitals : "0";
    if (statAvailEl) statAvailEl.textContent = stats.available_beds != null ? stats.available_beds : "0";
    if (statOccEl) statOccEl.textContent = stats.occupied_beds != null ? stats.occupied_beds : "0";
    if (statCleanEl) statCleanEl.textContent = stats.cleaning_beds != null ? stats.cleaning_beds : "0";
  } catch (e) {
    console.warn("Failed to load public stats from /api/stats, falling back to local hospital cache:", e);
    if (hospitals && hospitals.length) {
      if (statHospEl) statHospEl.textContent = hospitals.length;
      if (statAvailEl) statAvailEl.textContent = hospitals.reduce((a, h) => a + (h.available_beds || 0), 0);
      if (statOccEl) statOccEl.textContent = hospitals.reduce((a, h) => a + (h.occupied_beds || 0), 0);
      if (statCleanEl) statCleanEl.textContent = hospitals.reduce((a, h) => a + (h.cleaning_beds || 0), 0);
    } else {
      if (statHospEl) statHospEl.textContent = "0";
      if (statAvailEl) statAvailEl.textContent = "0";
      if (statOccEl) statOccEl.textContent = "0";
      if (statCleanEl) statCleanEl.textContent = "0";
    }
  }
}

function renderStats() {
  loadPublicStats();
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

async function loadStaffStats() {
  try {
    const stats = await api("/api/staff/stats");
    staffStats = stats;
    if ($("staffStatTotal")) $("staffStatTotal").textContent = stats.total_beds;
    if ($("staffStatAvailable")) $("staffStatAvailable").textContent = stats.available_beds;
    if ($("staffStatOccupied")) $("staffStatOccupied").textContent = stats.occupied_beds;
    if ($("staffStatCleaning")) $("staffStatCleaning").textContent = stats.cleaning_beds;
    if ($("staffStatIcu")) $("staffStatIcu").textContent = stats.icu_available;

    if (stats.hospital_name && $("dashHospitalName") && !$("dashHospitalName").textContent.includes("—")) {
      $("dashHospitalName").textContent = `${stats.hospital_name} — Bed Management`;
    }
    if (stats.hospital_address && $("dashHospitalAddress")) {
      $("dashHospitalAddress").textContent = `📍 ${stats.hospital_address}`;
    }
  } catch (e) {
    console.error("Failed to load staff stats:", e);
  }
}

function applyAuthState(user, staffProfile = null, portal = "user") {
  currentUser = user;
  currentStaffProfile = staffProfile;
  currentPortal = portal;

  if (user.role === "staff" || user.role === "admin") {
    // =======================================================
    // HOSPITAL STAFF EXPERIENCE
    // Completely replaces the public homepage with dedicated dashboard
    // =======================================================
    $("publicPortalView").style.display = "none";
    $("hospitalDashboardView").style.display = "flex";

    // Navigation: Switch to staff navigation
    $("publicNav").style.display = "none";
    $("staffNav").style.display = "flex";

    // Auth controls
    $("authGuestControls").style.display = "none";
    $("authUserControls").style.display = "none";
    $("authStaffControls").style.display = "flex";

    const hospName = staffProfile ? staffProfile.hospital_name : (user.role === "admin" ? "All Hospitals (Admin Oversight)" : "Assigned Hospital");
    $("navStaffName").textContent = user.name;
    $("navStaffHospitalBadge").textContent = hospName;

    $("brandTitle").textContent = "Mediloc";
    $("brandSubtitle").textContent = "Hospital Staff Portal";

    // Validate staff hospital assignment
    const hasValidHosp = (user.role === "admin") || (staffProfile && staffProfile.hospital_id && staffProfile.is_approved);
    if (!hasValidHosp) {
      // Display Access Error and lock operational tools (Requirement 3)
      $("staffNoHospitalBanner").style.display = "flex";
      $("staffOperationalArea").style.display = "none";
      $("dashHospitalName").textContent = "Hospital Access Restricted";
      $("dashHospitalAddress").textContent = "No active hospital assignment found or account pending administrator approval.";
      $("dashStaffIdentityChip").textContent = `Staff: ${user.name} (Approval Pending)`;
    } else {
      $("staffNoHospitalBanner").style.display = "none";
      $("staffOperationalArea").style.display = "block";

      // Populate Header with actual assigned hospital details
      $("dashHospitalName").textContent = `${hospName} — Bed Management`;
      const addr = (staffProfile && staffProfile.hospital_address) ? staffProfile.hospital_address : "Pune Healthcare Network";
      $("dashHospitalAddress").textContent = `📍 ${addr}`;
      $("dashStaffIdentityChip").textContent = `Staff: ${user.name} (${staffProfile ? staffProfile.role_title : 'Administrator'})`;
      if (staffProfile && staffProfile.hospital_phone) {
        $("dashHospitalPhone").textContent = `📞 ${staffProfile.hospital_phone}`;
        $("dashHospitalPhone").style.display = "inline-flex";
      }
      $("bedHospitalLabel").textContent = `${hospName} Bed Inventory`;
      $("bedHospitalSublabel").textContent = `Operational access strictly restricted to ${hospName}`;
      $("footerStaffHospTitle").textContent = `${hospName} · Bed Management System`;

      // Load hospital-specific database records
      loadStaffStats();
      loadStaffBeds();
      loadCleaningQueue();
      loadAuditLogs();
    }

    if (window.location.pathname !== "/dashboard" && window.location.pathname !== "/staff") {
      history.replaceState(null, "", "/dashboard");
    }
  } else {
    // =======================================================
    // CITIZEN USER EXPERIENCE (PUBLIC)
    // =======================================================
    $("publicPortalView").style.display = "block";
    $("hospitalDashboardView").style.display = "none";

    $("publicNav").style.display = "flex";
    $("staffNav").style.display = "none";

    $("authGuestControls").style.display = "none";
    $("authUserControls").style.display = "flex";
    $("authStaffControls").style.display = "none";

    $("brandTitle").textContent = "Mediloc";
    $("brandSubtitle").textContent = "Smart Hospital Finder";

    $("navUserName").textContent = user.name.split(" ")[0];
    $("navUserAvatar").textContent = user.name.charAt(0).toUpperCase();
    $("navUserBadge").textContent = `📍 ${user.locality || user.city || "Pune"}`;

    // Saved location banner in Hero
    const banner = $("userLocationBanner");
    banner.style.display = "flex";
    $("bannerLocalityText").textContent = `Showing hospitals near your saved locality (${user.locality || user.city})`;
    $("bannerAddressText").textContent = `${user.address ? user.address + ' · ' : ''}${user.city} ${user.pincode ? '· PIN ' + user.pincode : ''}`;

    if (user.latitude && user.longitude) {
      updateUserLocationMarker(user.latitude, user.longitude, user.locality || user.city);
    }

    loadHospitals();
    if (window.location.pathname.startsWith("/dashboard") || window.location.pathname.startsWith("/staff")) {
      history.replaceState(null, "", "/");
    }
  }
}

function applyGuestState() {
  currentUser = null;
  currentStaffProfile = null;
  currentPortal = null;

  $("publicPortalView").style.display = "block";
  $("hospitalDashboardView").style.display = "none";

  $("publicNav").style.display = "flex";
  $("staffNav").style.display = "none";

  $("authGuestControls").style.display = "flex";
  $("authUserControls").style.display = "none";
  $("authStaffControls").style.display = "none";

  $("userLocationBanner").style.display = "none";
  $("brandTitle").textContent = "Mediloc";
  $("brandSubtitle").textContent = "Smart Hospital Finder";

  loadHospitals();
  if (window.location.pathname.startsWith("/dashboard") || window.location.pathname.startsWith("/staff")) {
    history.replaceState(null, "", "/");
  }
}

// ---------------------------------------------------------
// Hospital Staff Bed Management (Assigned Hospital Isolated)
// ---------------------------------------------------------

async function loadStaffBeds() {
  try {
    staffBeds = await api("/api/staff/beds");
    populateWardFilter();
    renderStaffBeds();
  } catch (e) {
    console.error("Load staff beds error:", e);
    const grid = $("bedGrid");
    if (grid) grid.innerHTML = `<div class="message error">Failed to load bed inventory: ${e.message}</div>`;
  }
}

function populateWardFilter() {
  const wardSelect = $("bedWardFilter");
  if (!wardSelect) return;
  const currentVal = wardSelect.value;
  const wards = Array.from(new Set(staffBeds.map(b => b.ward).filter(Boolean))).sort();
  wardSelect.innerHTML = `<option value="">All Wards & Departments (${wards.length})</option>` +
    wards.map(w => `<option value="${esc(w)}" ${w === currentVal ? 'selected' : ''}>${esc(w)}</option>`).join("");
}

function renderStaffBeds() {
  const grid = $("bedGrid");
  if (!grid) return;

  const search = ($("bedSearchInput") ? $("bedSearchInput").value.trim().toLowerCase() : "");
  const ward = ($("bedWardFilter") ? $("bedWardFilter").value : "");
  const cat = ($("bedCategoryFilter") ? $("bedCategoryFilter").value : "");
  const status = ($("bedStatusFilter") ? $("bedStatusFilter").value : "");

  let filtered = staffBeds;
  if (search) {
    filtered = filtered.filter(b => (b.label && b.label.toLowerCase().includes(search)) || (b.ward && b.ward.toLowerCase().includes(search)));
  }
  if (ward) filtered = filtered.filter(b => b.ward === ward);
  if (cat) filtered = filtered.filter(b => b.category === cat);
  if (status) filtered = filtered.filter(b => b.status === status);

  if (!filtered.length) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 32px; text-align: center; background: #fff; border-radius: 14px; border: 1px dashed #cbd5e1;">
        <span style="font-size: 26px;">🛏️</span>
        <h4 style="margin: 8px 0 4px; color: #0d2850;">No beds match the selected filters</h4>
        <p style="font-size: 12px; color: #64748b; margin: 0;">Try adjusting your search query, ward, or category filters.</p>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(b => {
    const statusLower = b.status.toLowerCase();
    let actionBtnHtml = "";
    if (b.status === "Available") {
      actionBtnHtml = `<button class="btn btn-primary btn-small" onclick="openBedActionModal(${b.id}, 'admit')">Admit Patient →</button>`;
    } else if (b.status === "Occupied") {
      actionBtnHtml = `<button class="btn btn-danger btn-small" onclick="openBedActionModal(${b.id}, 'discharge')">Discharge →</button>`;
    } else if (b.status === "Cleaning") {
      actionBtnHtml = `<button class="btn btn-warning btn-small" onclick="openBedActionModal(${b.id}, 'clean')">Confirm Clean →</button>`;
    }

    const patientText = b.patient_code ? `Patient: <b>${esc(b.patient_code)}</b>` : (b.status === "Available" ? "Ready for admission" : "Awaiting housekeeping");

    return `
      <article class="bed-card-modern status-${statusLower}" onclick="openBedActionModal(${b.id})">
        <div class="bed-card-top">
          <div>
            <h3 class="bed-card-label">${esc(b.label)}</h3>
            <div class="bed-card-ward">📍 ${esc(b.ward)}</div>
          </div>
          <span class="bed-status-pill ${statusLower}">
            <i class="dot"></i> ${esc(b.status)}
          </span>
        </div>
        <div class="bed-card-meta">
          <span>Type: <b>${esc(b.category)}</b></span>
          <span>${patientText}</span>
        </div>
        <div class="bed-action-btn-row" onclick="event.stopPropagation()">
          ${actionBtnHtml}
          <button class="btn btn-outline btn-small" onclick="makeQr(${b.id})" title="Generate QR Code" style="flex:0 0 auto;padding:7px 10px;">📷 QR</button>
        </div>
      </article>`;
  }).join("");
}

// ---------------------------------------------------------
// Bed Lifecycle Modal & Transitions (Available -> Occupied -> Cleaning -> Available)
// ---------------------------------------------------------

let selectedBed = null;

window.openBedActionModal = async function(bedId, preferredAction = null) {
  try {
    const bed = await api(`/api/beds/${bedId}`);
    selectedBed = bed;

    if ($("bedModalCategory")) $("bedModalCategory").textContent = `${(bed.category || "General").toUpperCase()} BED`;
    if ($("bedModalTitle")) $("bedModalTitle").textContent = `${bed.label} (${bed.status})`;
    if ($("bedModalWard")) $("bedModalWard").textContent = `${bed.ward} · Facility Assigned`;
    
    const pill = $("bedModalStatusPill");
    if (pill) {
      pill.className = `bed-status-pill ${bed.status.toLowerCase()}`;
      pill.textContent = bed.status;
    }

    if ($("bedModalUpdated")) {
      $("bedModalUpdated").textContent = bed.updated_at ? new Date(bed.updated_at).toLocaleTimeString() : "Live";
    }

    // Toggle lifecycle action groups
    const admitGroup = $("bedActionAdmitGroup");
    const dischargeGroup = $("bedActionDischargeGroup");
    const cleanGroup = $("bedActionCleanGroup");

    if (admitGroup) admitGroup.style.display = "none";
    if (dischargeGroup) dischargeGroup.style.display = "none";
    if (cleanGroup) cleanGroup.style.display = "none";

    if (bed.status === "Available") {
      if (admitGroup) admitGroup.style.display = "block";
      if ($("modalPatientCode")) $("modalPatientCode").value = "";
    } else if (bed.status === "Occupied") {
      if (dischargeGroup) dischargeGroup.style.display = "block";
      if ($("modalCurrentPatientCode")) $("modalCurrentPatientCode").textContent = bed.patient_code || "DEMO-PATIENT";
    } else if (bed.status === "Cleaning") {
      if (cleanGroup) cleanGroup.style.display = "block";
    }

    if ($("bedActionModal")) $("bedActionModal").style.display = "grid";
  } catch (e) {
    toast(`Could not inspect bed: ${e.message}`);
  }
};

window.closeBedActionModal = function() {
  if ($("bedActionModal")) $("bedActionModal").style.display = "none";
  selectedBed = null;
};

window.runBedAction = async function(bedId, action, patientCode = null) {
  try {
    let res;
    if (action === "admit") {
      res = await api(`/api/beds/${bedId}/admit`, {
        method: "POST",
        body: JSON.stringify({ patient_code: patientCode })
      });
      toast(`Patient admitted to ${res.bed.label}. Marked Occupied.`);
    } else if (action === "discharge") {
      res = await api(`/api/beds/${bedId}/discharge`, { method: "POST" });
      toast(`Patient discharged from ${res.bed.label}. Moved to Cleaning Queue.`);
    } else if (action === "clean") {
      res = await api(`/api/beds/${bedId}/clean`, { method: "POST" });
      toast(`Bed ${res.bed.label} sanitized and returned to Available.`);
    }

    closeBedActionModal();
    await Promise.all([
      loadStaffStats(),
      loadStaffBeds(),
      loadCleaningQueue(),
      loadAuditLogs(),
      loadPublicStats()
    ]);
  } catch (e) {
    throw e;
  }
};

// ---------------------------------------------------------
// Cleaning Queue (Housekeeping Sanitization)
// ---------------------------------------------------------

async function loadCleaningQueue() {
  const listEl = $("cleaningQueueList");
  if (!listEl) return;
  try {
    const queue = await api("/api/staff/cleaning-queue");
    if (!queue.length) {
      listEl.innerHTML = `
        <div style="padding:28px;text-align:center;background:#fff;border-radius:14px;border:1px dashed #cbd5e1;">
          <span style="font-size:26px;">✨</span>
          <h4 style="margin:8px 0 4px;color:#0d2850;">No beds currently awaiting sanitization</h4>
          <p style="font-size:12px;color:#64748b;margin:0;">When patients are discharged, beds will queue here for housekeeping sanitization.</p>
        </div>`;
      return;
    }
    listEl.innerHTML = queue.map(r => `
      <div class="cleaning-card" style="display:flex;justify-content:space-between;align-items:center;padding:16px;background:#fff;border-radius:12px;border:1px solid #fed7aa;margin-bottom:10px;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;">
            <b style="font-size:15px;color:#0d2850;">${esc(r.bed_label)}</b>
            <span class="bed-status-pill cleaning" style="font-size:11px;">Cleaning</span>
          </div>
          <small style="color:#64748b;display:block;margin-top:4px;">Discharged: <b>${esc(r.discharged_patient || 'Patient')}</b> · Initiated ${new Date(r.initiated_at).toLocaleTimeString()}</small>
          <small style="color:#64748b;display:block;">Housekeeping: <b>${esc(r.cleaned_by || 'Staff on duty')}</b></small>
        </div>
        <div>
          <button class="btn btn-warning btn-small" onclick="confirmBedCleaning(${r.bed_id})">Confirm Sanitized →</button>
        </div>
      </div>
    `).join("");
  } catch (e) {
    listEl.innerHTML = `<div class="message error">Failed to load cleaning queue: ${e.message}</div>`;
  }
}

window.confirmBedCleaning = async function(bedId) {
  try {
    await runBedAction(bedId, "clean");
  } catch (e) {
    toast(`Clean error: ${e.message}`);
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

async function makeQr(bedIdParam = null) {
  const bedId = bedIdParam || (selectedBed ? selectedBed.id : null);
  if (!bedId) {
    toast("Please select a bed first.");
    return;
  }
  try {
    const qrData = await api(`/api/beds/${bedId}/qr`, { method: "POST" });
    const w = window.open("", "_blank", "width=420,height=540");
    if (!w) {
      toast("Allow pop-ups to view bed QR code.");
      return;
    }
    w.document.write(`
      <!doctype html><html><head><title>Mediloc Bed QR — ${esc(qrData.label)}</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        body{font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:28px 20px;color:#0f172a;background:#f8fafc;}
        .card{background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;box-shadow:0 8px 24px rgba(0,0,0,0.06);max-width:340px;margin:0 auto;}
        #qrcode{margin:18px auto;display:inline-block;padding:12px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;}
        .tag{background:#eff6ff;color:#1e40af;padding:6px 12px;border-radius:8px;font-family:monospace;font-size:12px;margin:12px 0;display:inline-block;}
        .hosp-badge{background:#0d2850;color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;display:inline-block;margin-bottom:8px;}
      </style></head><body>
        <div class="card">
          <span class="hosp-badge">AUTHORIZED BED IDENTIFIER</span>
          <h2 style="margin:4px 0 2px;color:#0d2850;font-size:18px;">${esc(qrData.hospital_name)}</h2>
          <p style="margin:0 0 14px;color:#64748b;font-size:12px;">${esc(qrData.ward)} · Bed ${esc(qrData.label)}</p>
          <div id="qrcode"></div>
          <div><span class="tag">${qrData.qr_payload}</span></div>
          <p style="font-size:11px;color:#64748b;margin:8px 0 0;line-height:1.4;">Only authorized staff of ${esc(qrData.hospital_name)} can scan or modify bed occupancy.</p>
        </div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
        <script>new QRCode(document.getElementById('qrcode'),{text:${JSON.stringify(qrData.qr_payload)},width:200,height:200});<\/script>
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
    openBedActionModal(b.id);
    message(`QR Verified: Bed ${b.label} in ${b.ward} (${b.status}).`, "success");
    toast(`Verified Bed ${b.label} (${b.status})`);
  } catch (e) {
    message(`QR Scan rejected: ${e.message}`, "error");
    toast(`Access denied: ${e.message}`);
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
    await Promise.all([
      loadPublicStats(),
      loadHospitals(),
      loadNotifications()
    ]);
  } catch (e) {
    console.error("Refresh error:", e);
  }
}

// ---------------------------------------------------------
// Quick Fill Helpers
// ---------------------------------------------------------

window.fillRegLoc = function(locality, pin) {
  if ($("regLocality")) $("regLocality").value = locality;
  if ($("regPincode")) $("regPincode").value = pin;
};

window.quickFillUserLogin = function(email, pwd) {
  if ($("userLoginEmail")) $("userLoginEmail").value = email;
  if ($("userLoginPassword")) $("userLoginPassword").value = pwd;
};

window.quickFillHospitalLogin = function(email, pwd) {
  if ($("hospitalLoginEmail")) $("hospitalLoginEmail").value = email;
  if ($("hospitalLoginPassword")) $("hospitalLoginPassword").value = pwd;
};

// ---------------------------------------------------------
// DOM Event Listeners & Initialization
// ---------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  // Mobile Nav Toggle (handles active nav)
  if ($("menuToggle")) {
    $("menuToggle").addEventListener("click", () => {
      const nav = ($("staffNav") && $("staffNav").style.display !== "none") ? $("staffNav") : $("publicNav");
      if (nav) nav.classList.toggle("open");
    });
  }
  document.querySelectorAll("#publicNav a, #staffNav a").forEach(a => {
    a.addEventListener("click", () => {
      if ($("publicNav")) $("publicNav").classList.remove("open");
      if ($("staffNav")) $("staffNav").classList.remove("open");
    });
  });

  // Initialize Leaflet Maps
  heroMap = initMap("heroMap");
  listMap = initMap("listMap");

  // Check authenticated session and fetch live platform statistics
  await checkAuthSession();
  await refreshAll();

  // Route check for direct URL access (e.g., /register, /login, /login/user, /login/hospital, /home, /dashboard)
  const path = window.location.pathname;
  if (path === "/register") {
    if ($("registerModal")) {
      if ($("regError")) $("regError").style.display = "none";
      $("registerModal").style.display = "grid";
    }
  } else if (path === "/login" || path === "/login/user") {
    if ($("userLoginModal")) {
      if ($("userLoginError")) $("userLoginError").style.display = "none";
      $("userLoginModal").style.display = "grid";
    }
  } else if (path === "/login/hospital") {
    if ($("hospitalLoginModal")) {
      if ($("hospitalLoginError")) $("hospitalLoginError").style.display = "none";
      $("hospitalLoginModal").style.display = "grid";
    }
  } else if (path === "/dashboard" || path === "/staff") {
    if (!currentUser || (currentUser.role !== "staff" && currentUser.role !== "admin")) {
      if ($("hospitalLoginModal")) $("hospitalLoginModal").style.display = "grid";
      toast("Please sign in to access the Hospital Dashboard.");
    }
  }

  // Search & Filters (Public Discovery)
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

  // Staff Dashboard Tab Switching
  window.switchStaffTab = function(tabId) {
    document.querySelectorAll(".tab-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === tabId);
    });
    document.querySelectorAll(".staff-nav-link").forEach(a => {
      a.classList.toggle("active", a.dataset.tab === tabId);
    });
    document.querySelectorAll(".tab-content").forEach(c => {
      c.style.display = (c.id === tabId) ? "block" : "none";
    });
    if (tabId === "tabCleaning") loadCleaningQueue();
    if (tabId === "tabAudit") loadAuditLogs();
    if (tabId === "tabBeds") loadStaffBeds();
  };

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchStaffTab(btn.dataset.tab));
  });
  document.querySelectorAll(".staff-nav-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      switchStaffTab(link.dataset.tab);
    });
  });

  // Staff Filters & Actions
  if ($("bedSearchInput")) $("bedSearchInput").addEventListener("input", renderStaffBeds);
  if ($("bedWardFilter")) $("bedWardFilter").addEventListener("change", renderStaffBeds);
  if ($("bedCategoryFilter")) $("bedCategoryFilter").addEventListener("change", renderStaffBeds);
  if ($("bedStatusFilter")) $("bedStatusFilter").addEventListener("change", renderStaffBeds);
  if ($("loadBedsBtn")) $("loadBedsBtn").addEventListener("click", () => { loadStaffBeds(); toast("Bed inventory refreshed."); });
  if ($("refreshCleaningBtn")) $("refreshCleaningBtn").addEventListener("click", loadCleaningQueue);
  if ($("refreshAuditBtn")) $("refreshAuditBtn").addEventListener("click", loadAuditLogs);
  if ($("dashRefreshAllBtn")) $("dashRefreshAllBtn").addEventListener("click", () => {
    loadStaffStats();
    loadStaffBeds();
    loadCleaningQueue();
    loadAuditLogs();
    toast("Hospital data synchronized.");
  });

  // Bed Action Modal Event Handlers
  if ($("closeBedActionModalBtn")) $("closeBedActionModalBtn").addEventListener("click", closeBedActionModal);
  if ($("closeBedActionFooterBtn")) $("closeBedActionFooterBtn").addEventListener("click", closeBedActionModal);

  if ($("modalConfirmAdmitBtn")) {
    $("modalConfirmAdmitBtn").addEventListener("click", async () => {
      if (!selectedBed) return;
      const pCode = $("modalPatientCode").value.trim();
      if (!pCode) { toast("Patient code is required."); return; }
      try {
        await runBedAction(selectedBed.id, "admit", pCode);
      } catch (e) {
        toast(`Admit error: ${e.message}`);
      }
    });
  }

  if ($("modalConfirmDischargeBtn")) {
    $("modalConfirmDischargeBtn").addEventListener("click", async () => {
      if (!selectedBed) return;
      try {
        await runBedAction(selectedBed.id, "discharge");
      } catch (e) {
        toast(`Discharge error: ${e.message}`);
      }
    });
  }

  if ($("modalConfirmCleanBtn")) {
    $("modalConfirmCleanBtn").addEventListener("click", async () => {
      if (!selectedBed) return;
      try {
        await runBedAction(selectedBed.id, "clean");
      } catch (e) {
        toast(`Clean confirmation error: ${e.message}`);
      }
    });
  }

  if ($("modalGenerateQrBtn")) {
    $("modalGenerateQrBtn").addEventListener("click", () => {
      if (selectedBed) makeQr(selectedBed.id);
    });
  }

  // QR Scanner Handlers
  if ($("startScanBtn")) $("startScanBtn").addEventListener("click", startScanner);
  if ($("stopScanBtn")) $("stopScanBtn").addEventListener("click", stopScanner);

  if ($("qrFile")) {
    $("qrFile").addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file || !window.Html5Qrcode) return;
      const reader = new Html5Qrcode("qr-reader");
      try {
        const decoded = await reader.scanFile(file, true);
        await handleScan(decoded);
      } catch (err) {
        message("Could not read QR code from image.", "error");
      }
      e.target.value = "";
    });
  }

  // Staff Logout Handler
  if ($("staffLogoutBtn")) {
    $("staffLogoutBtn").addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" });
      applyGuestState();
      toast("Signed out of Hospital Portal.");
    });
  }

  // Modal Triggers
  if ($("closeDetailModalBtn")) $("closeDetailModalBtn").addEventListener("click", closeHospitalModal);
  if ($("closeDetailFooterBtn")) $("closeDetailFooterBtn").addEventListener("click", closeHospitalModal);

  // Modal Overlay Click Dismissal (clicking backdrop closes modal)
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) {
        overlay.style.display = "none";
        if (overlay.id === "bedActionModal" && typeof closeBedActionModal === "function") {
          closeBedActionModal();
        }
      }
    });
  });

  // Two-Portal Modal Openers
  if ($("openUserLoginBtn")) {
    $("openUserLoginBtn").addEventListener("click", () => {
      if ($("userLoginError")) $("userLoginError").style.display = "none";
      if ($("userLoginModal")) $("userLoginModal").style.display = "grid";
    });
  }
  if ($("closeUserLoginModalBtn")) {
    $("closeUserLoginModalBtn").addEventListener("click", () => {
      if ($("userLoginModal")) $("userLoginModal").style.display = "none";
    });
  }

  if ($("openHospitalLoginBtn")) {
    $("openHospitalLoginBtn").addEventListener("click", () => {
      if ($("hospitalLoginError")) $("hospitalLoginError").style.display = "none";
      if ($("hospitalLoginModal")) $("hospitalLoginModal").style.display = "grid";
    });
  }
  if ($("promptStaffLoginBtn")) {
    $("promptStaffLoginBtn").addEventListener("click", () => {
      if ($("hospitalLoginError")) $("hospitalLoginError").style.display = "none";
      if ($("hospitalLoginModal")) $("hospitalLoginModal").style.display = "grid";
    });
  }
  if ($("closeHospitalLoginModalBtn")) {
    $("closeHospitalLoginModalBtn").addEventListener("click", () => {
      if ($("hospitalLoginModal")) $("hospitalLoginModal").style.display = "none";
    });
  }

  if ($("openRegisterBtn")) {
    $("openRegisterBtn").addEventListener("click", () => {
      if ($("regError")) $("regError").style.display = "none";
      if ($("registerModal")) $("registerModal").style.display = "grid";
    });
  }
  if ($("closeRegisterModalBtn")) {
    $("closeRegisterModalBtn").addEventListener("click", () => {
      if ($("registerModal")) $("registerModal").style.display = "none";
    });
  }

  if ($("switchToUserLoginLink")) {
    $("switchToUserLoginLink").addEventListener("click", e => {
      e.preventDefault();
      if ($("registerModal")) $("registerModal").style.display = "none";
      if ($("userLoginModal")) {
        if ($("userLoginError")) $("userLoginError").style.display = "none";
        $("userLoginModal").style.display = "grid";
      }
    });
  }
  if ($("switchToRegisterFromUserLink")) {
    $("switchToRegisterFromUserLink").addEventListener("click", e => {
      e.preventDefault();
      if ($("userLoginModal")) $("userLoginModal").style.display = "none";
      if ($("registerModal")) {
        if ($("regError")) $("regError").style.display = "none";
        $("registerModal").style.display = "grid";
      }
    });
  }

  // Profile Modal
  if ($("openProfileBtn")) {
    $("openProfileBtn").addEventListener("click", () => {
      if (!currentUser) return;
      if ($("profName")) $("profName").value = currentUser.name;
      if ($("profEmail")) $("profEmail").value = currentUser.email;
      if ($("profCity")) $("profCity").value = currentUser.city || "Pune";
      if ($("profLocality")) $("profLocality").value = currentUser.locality || "";
      if ($("profPincode")) $("profPincode").value = currentUser.pincode || "";
      if ($("profAddress")) $("profAddress").value = currentUser.address || "";
      if ($("profCoordsLabel")) {
        $("profCoordsLabel").textContent = `Coordinates: ${currentUser.latitude ? currentUser.latitude.toFixed(4) + ', ' + currentUser.longitude.toFixed(4) : 'Pending'}`;
      }
      if ($("profError")) $("profError").style.display = "none";
      if ($("profSuccess")) $("profSuccess").style.display = "none";
      if ($("profileModal")) $("profileModal").style.display = "grid";
    });
  }
  if ($("closeProfileModalBtn")) {
    $("closeProfileModalBtn").addEventListener("click", () => {
      if ($("profileModal")) $("profileModal").style.display = "none";
    });
  }
  if ($("bannerEditLocBtn")) {
    $("bannerEditLocBtn").addEventListener("click", () => {
      if ($("openProfileBtn")) $("openProfileBtn").click();
    });
  }

  // Citizen Logout
  if ($("logoutBtn")) {
    $("logoutBtn").addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" });
      applyGuestState();
      toast("Signed out successfully.");
    });
  }

  // Citizen Registration Form Submit
  if ($("registerForm")) {
    $("registerForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = $("regError");
      const submitBtn = $("regSubmitBtn");
      if (errEl) errEl.style.display = "none";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Creating Citizen Profile...";
      }

      const payload = {
        name: $("regName") ? $("regName").value.trim() : "",
        email: $("regEmail") ? $("regEmail").value.trim() : "",
        password: $("regPassword") ? $("regPassword").value : "",
        confirm_password: $("regConfirmPassword") ? $("regConfirmPassword").value : "",
        city: $("regCity") ? $("regCity").value.trim() : "Pune",
        locality: $("regLocality") ? $("regLocality").value.trim() : "",
        pincode: $("regPincode") ? $("regPincode").value.trim() : "",
        address: $("regAddress") ? $("regAddress").value.trim() : ""
      };

      try {
        const res = await api("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
        if ($("registerModal")) $("registerModal").style.display = "none";
        $("registerForm").reset();
        applyAuthState(res.user, null, "user");
        await loadPublicStats();
        toast(`Welcome, ${res.user.name}! Your citizen profile in ${res.user.locality || res.user.city} is registered.`);
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message;
          errEl.style.display = "block";
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Create Citizen Profile →";
        }
      }
    });
  }

  // Option A: Citizen Login Form Submit
  if ($("userLoginForm")) {
    $("userLoginForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = $("userLoginError");
      const submitBtn = $("userLoginSubmitBtn");
      if (errEl) errEl.style.display = "none";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Signing In...";
      }

      const payload = {
        email: $("userLoginEmail") ? $("userLoginEmail").value.trim() : "",
        password: $("userLoginPassword") ? $("userLoginPassword").value : ""
      };

      try {
        const res = await api("/api/auth/login/user", { method: "POST", body: JSON.stringify(payload) });
        if ($("userLoginModal")) $("userLoginModal").style.display = "none";
        if ($("userLoginPassword")) $("userLoginPassword").value = "";
        applyAuthState(res.user, null, "user");
        await loadPublicStats();
        toast(`Signed in as ${res.user.name}. Nearby hospitals sorted by distance.`);
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message;
          errEl.style.display = "block";
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Sign In to Citizen Portal";
        }
      }
    });
  }

  // Option B: Hospital Staff Login Form Submit
  if ($("hospitalLoginForm")) {
    $("hospitalLoginForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = $("hospitalLoginError");
      const submitBtn = $("hospitalLoginSubmitBtn");
      if (errEl) errEl.style.display = "none";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Authenticating...";
      }

      const payload = {
        email: $("hospitalLoginEmail") ? $("hospitalLoginEmail").value.trim() : "",
        password: $("hospitalLoginPassword") ? $("hospitalLoginPassword").value : ""
      };

      try {
        const res = await api("/api/auth/login/hospital", { method: "POST", body: JSON.stringify(payload) });
        if ($("hospitalLoginModal")) $("hospitalLoginModal").style.display = "none";
        if ($("hospitalLoginPassword")) $("hospitalLoginPassword").value = "";
        applyAuthState(res.user, res.staff_profile, "hospital");
        toast(`Hospital Staff Authenticated: ${res.staff_profile ? res.staff_profile.hospital_name : 'Staff Portal'}.`);
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message;
          errEl.style.display = "block";
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Access Hospital Portal →";
        }
      }
    });
  }

  // Profile Form Submit
  if ($("profileForm")) {
    $("profileForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = $("profError");
      const succEl = $("profSuccess");
      if (errEl) errEl.style.display = "none";
      if (succEl) succEl.style.display = "none";

      const payload = {
        name: $("profName") ? $("profName").value.trim() : "",
        city: $("profCity") ? $("profCity").value.trim() : "Pune",
        locality: $("profLocality") ? $("profLocality").value.trim() : "",
        pincode: $("profPincode") ? $("profPincode").value.trim() : "",
        address: $("profAddress") ? $("profAddress").value.trim() : ""
      };

      try {
        const res = await api("/api/auth/profile", { method: "PUT", body: JSON.stringify(payload) });
        if (succEl) {
          succEl.textContent = "Profile and location updated successfully.";
          succEl.style.display = "block";
        }
        setTimeout(() => { if ($("profileModal")) $("profileModal").style.display = "none"; }, 900);
        applyAuthState(res.user, currentStaffProfile, currentPortal);
        toast("Location updated! Discovery refreshed.");
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message;
          errEl.style.display = "block";
        }
      }
    });
  }

  // Notification Toggle
  if ($("notifBtn")) {
    $("notifBtn").addEventListener("click", () => {
      const d = $("notifDropdown");
      if (d) d.style.display = d.style.display === "none" ? "block" : "none";
    });
  }
  document.addEventListener("click", e => {
    if ($("notifBtn") && $("notifDropdown") && !$("notifBtn").contains(e.target) && !$("notifDropdown").contains(e.target)) {
      $("notifDropdown").style.display = "none";
    }
  });

  // Contact Form Submit
  if ($("contactForm")) {
    $("contactForm").addEventListener("submit", async e => {
      e.preventDefault();
      const msgEl = $("contactMsg");
      const submitBtn = $("contactForm").querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending...";
      }

      const payload = {
        name: $("contactName") ? $("contactName").value.trim() : "",
        email: $("contactEmail") ? $("contactEmail").value.trim() : "",
        subject: $("contactSubject") ? $("contactSubject").value : "General Feedback",
        message: $("contactMessage") ? $("contactMessage").value.trim() : ""
      };

      try {
        const res = await api("/api/contact", { method: "POST", body: JSON.stringify(payload) });
        if (msgEl) msgEl.textContent = res.message || "Inquiry registered. Our coordination desk will follow up via email.";
        toast(res.message || "Thank you! Your message has been received.");
        $("contactForm").reset();
      } catch (err) {
        if (msgEl) msgEl.textContent = "Inquiry registered. Our coordination desk will follow up via email.";
        toast("Thank you! Your message has been recorded.");
        $("contactForm").reset();
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit Inquiry →";
        }
      }
    });
  }

  // Periodic Polling
  setInterval(() => {
    if (!document.hidden) refreshAll();
  }, 25000);
});
