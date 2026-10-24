<<<<<<< HEAD
# Mediloc — Smart Hospital Finder & Two-Portal Multi-Hospital Security Architecture

A full-stack, responsive healthcare navigation and bed-management web application built with Flask, SQLAlchemy, SQLite (PostgreSQL-compatible), Leaflet.js, and mobile QR code integration.

---

## 🛡️ Critical Security Architecture: Two-Portal Access & Multi-Hospital Isolation

Mediloc enforces strict server-side multi-tenancy and role-based access control (RBAC) across two distinct portals:

### 1. Option A: Citizen / Patient Portal (`/login/user`)
- **Read-Only Hospital Discovery**: Public citizens can browse verified hospital availability, bed counts, ICU status, and map coordinates.
- **Saved Locality Persistence**: Users register with full name, email, securely hashed password (via Werkzeug), city, locality/area, PIN code, and optional address.
- **Automatic Post-Login Sorting**: When a citizen logs in, nearby hospitals are automatically sorted by proximity to their saved location.
- **Strict Read-Only Enforcement**: Public users have zero write permissions. Any attempt by a citizen to change bed status, admit/discharge patients, confirm cleaning, or generate operational bed QR codes is rejected by the server with `403 Forbidden`.
- **Privilege Escalation Prevention**: Public registration unconditionally forces `role = 'user'`, ignoring any malicious client attempts to self-promote to `admin` or `staff`.

### 2. Option B: Hospital Staff Portal (`/login/hospital`)
- **Dedicated Staff Portal**: Healthcare personnel sign in through the dedicated hospital portal.
- **Server-Side Hospital Assignment**: Each staff account is associated with exactly one hospital (`HospitalStaff.hospital_id`), and must be active (`is_active=True`) and approved (`is_approved=True`).
- **Multi-Hospital Data Isolation**:
  - Staff can access and modify **only** their assigned hospital's records.
  - The staff member's `hospital_id` is derived strictly from their authenticated session on the backend; client-supplied `hospital_id` query parameters or body payloads are ignored.
  - Cross-hospital bed modifications (e.g., Staff of Hospital A attempting to admit, discharge, clean, or QR-scan a bed belonging to Hospital B) are rejected with `403 Forbidden`.
- **Locked Dashboard View**: The staff dashboard prominently displays the staff member's assigned facility and removes cross-hospital switching selectors.
- **Enforced Bed Lifecycle**: `Available → Occupied → Cleaning → Available`. Discharged beds enter the facility's housekeeping queue and cannot return to Available status until sanitization is approved.

---

## 🧪 Demonstration Accounts (Multi-Hospital Isolation)

| Portal | Role | Email | Password | Facility Assignment & Status |
|---|---|---|---|---|
| **User Portal** | Citizen (Baner) | `user@mediloc.demo` | `DemoUser123!` | Public citizen (Saved locality: Baner, Pune) |
| **Hospital Portal** | Staff (Deccan) | `staff.deccan@mediloc.demo` | `DeccanStaff123!` | **Hospital 1**: Mediloc City Care Demo Hospital (Approved & Active) |
| **Hospital Portal** | Staff (Shivajinagar) | `staff.shivaji@mediloc.demo` | `ShivajiStaff123!` | **Hospital 2**: Mediloc Riverside Medical Centre (Approved & Active) |
| **Hospital Portal** | Staff (Kothrud) | `staff.kothrud@mediloc.demo` | `KothrudStaff123!` | **Hospital 3**: Mediloc Greenfield Demo Hospital (Approved & Active) |
| **Hospital Portal** | Pending Staff | `staff.pending@mediloc.demo` | `PendingStaff123!` | **Hospital 4**: Unapproved applicant (`403 Forbidden` on login) |
| **Hospital Portal** | Suspended Staff | `staff.inactive@mediloc.demo` | `InactiveStaff123!` | **Hospital 1**: Deactivated account (`403 Forbidden` on login) |
| **Hospital Portal** | System Admin | `admin@mediloc.demo` | `DemoAdmin123!` | System-wide administrative oversight |

---

## 🚀 Local Setup Instructions (Windows)

### Prerequisites
- Python 3.10+ installed and on PATH.

```powershell
# 1. Open PowerShell in the project directory
cd "d:\pbl project"

# 2. Activate virtual environment
.\.venv\Scripts\Activate.ps1

# 3. Install dependencies
pip install -r requirements.txt

# 4. Start the Mediloc application
python app.py
```

The application will be accessible at: **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

---

## 🔒 14-Point Automated Security Test Suite

Execute the security and multi-hospital isolation test suite:

```powershell
.\.venv\Scripts\python -m unittest tests/test_backend.py
```

### Verified Test Cases:
1. `test_01_public_user_view_availability`: Public user can view public hospital availability.
2. `test_02_public_user_cannot_change_bed_occupancy`: Public user cannot change bed occupancy (`403 Forbidden`).
3. `test_03_public_user_cannot_generate_qr`: Public user cannot generate bed QR codes (`403 Forbidden`).
4. `test_04_unapproved_staff_cannot_modify_beds`: Unapproved staff account denied access (`403 Forbidden`).
5. `test_05_staff_a_can_access_own_hospital_records`: Staff of Hospital A can access their facility's beds.
6. `test_06_staff_a_cannot_access_hospital_b_protected_records`: Multi-hospital isolation prevents inspecting other facilities.
7. `test_07_staff_a_cannot_change_hospital_b_bed_status`: Staff of Hospital A cannot modify Hospital B's beds (`403 Forbidden`).
8. `test_08_forged_hospital_id_in_request_rejected`: Forged `hospital_id` in request body cannot bypass authorization (`403 Forbidden`).
9. `test_09_forged_role_in_registration_fails`: Malicious `role: admin` in registration payload forced to `user`.
10. `test_10_unauthenticated_request_cannot_change_bed_status`: Unauthenticated requests rejected (`401 Unauthorized`).
11. `test_11_unauthorized_qr_scan_rejected`: Cross-hospital QR scanning rejected (`403 Forbidden`).
12. `test_12_deactivated_staff_cannot_perform_operations`: Deactivated staff accounts denied access (`403 Forbidden`).
13. `test_13_invalid_bed_state_transitions_rejected`: Enforces `Available → Occupied → Cleaning → Available` lifecycle (`409 Conflict`).
14. `test_14_audit_records_generated`: State-changing operations generate immutable audit records.
=======
# Real-time-bed-availablity-managment-system-
PBL project
>>>>>>> b29858cd295827d522f14b8dcbe499bef246d7b0
