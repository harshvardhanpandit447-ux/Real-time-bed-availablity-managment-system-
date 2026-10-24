import unittest
from app import app, db, User, Hospital, Bed, CleaningRecord, AuditLog, HospitalStaff
from werkzeug.security import generate_password_hash, check_password_hash

class MedilocSecurityTestCase(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        self.client = app.test_client()

        with app.app_context():
            db.drop_all()
            db.create_all()

            # Create Hospital A (Deccan)
            h_a = Hospital(
                name="Hospital A (Deccan)",
                address="Fergusson Road, Deccan, Pune",
                city="Pune",
                locality="Deccan",
                latitude=18.5167,
                longitude=73.8410,
                phone="+91 90000 11111",
                is_demo=True
            )
            # Create Hospital B (Shivajinagar)
            h_b = Hospital(
                name="Hospital B (Shivajinagar)",
                address="University Road, Shivajinagar, Pune",
                city="Pune",
                locality="Shivajinagar",
                latitude=18.5308,
                longitude=73.8475,
                phone="+91 90000 22222",
                is_demo=True
            )
            db.session.add_all([h_a, h_b])
            db.session.flush()

            # Beds for Hospital A
            b_a1 = Bed(hospital_id=h_a.id, label="A-BED-01", category="General", ward="Ward A", status="Available")
            b_a2 = Bed(hospital_id=h_a.id, label="A-BED-02", category="ICU", ward="ICU A", status="Occupied", patient_code="P-A-02")
            b_a3 = Bed(hospital_id=h_a.id, label="A-BED-03", category="General", ward="Ward A", status="Cleaning")

            # Beds for Hospital B
            b_b1 = Bed(hospital_id=h_b.id, label="B-BED-01", category="General", ward="Ward B", status="Available")
            b_b2 = Bed(hospital_id=h_b.id, label="B-BED-02", category="ICU", ward="ICU B", status="Occupied", patient_code="P-B-02")

            db.session.add_all([b_a1, b_a2, b_a3, b_b1, b_b2])
            db.session.flush()

            # User 1: Regular Public User
            u_public = User(
                name="Citizen User",
                email="user@test.com",
                password_hash=generate_password_hash("Password123!"),
                role="user",
                is_active=True,
                city="Pune",
                locality="Baner",
                latitude=18.5590,
                longitude=73.7868
            )

            # User 2: Staff for Hospital A (Approved & Active)
            u_staff_a = User(
                name="Staff Hospital A",
                email="staff_a@test.com",
                password_hash=generate_password_hash("Password123!"),
                role="staff",
                is_active=True
            )

            # User 3: Staff for Hospital B (Approved & Active)
            u_staff_b = User(
                name="Staff Hospital B",
                email="staff_b@test.com",
                password_hash=generate_password_hash("Password123!"),
                role="staff",
                is_active=True
            )

            # User 4: Staff Pending Approval
            u_staff_pending = User(
                name="Staff Pending",
                email="staff_pending@test.com",
                password_hash=generate_password_hash("Password123!"),
                role="staff",
                is_active=True
            )

            # User 5: Staff Deactivated
            u_staff_inactive = User(
                name="Staff Deactivated",
                email="staff_inactive@test.com",
                password_hash=generate_password_hash("Password123!"),
                role="staff",
                is_active=False
            )

            # User 6: Administrator
            u_admin = User(
                name="Admin User",
                email="admin@test.com",
                password_hash=generate_password_hash("Admin123!"),
                role="admin",
                is_active=True
            )

            db.session.add_all([u_public, u_staff_a, u_staff_b, u_staff_pending, u_staff_inactive, u_admin])
            db.session.flush()

            # Staff assignments
            sp_a = HospitalStaff(user_id=u_staff_a.id, hospital_id=h_a.id, role_title="Nurse A", is_approved=True)
            sp_b = HospitalStaff(user_id=u_staff_b.id, hospital_id=h_b.id, role_title="Doctor B", is_approved=True)
            sp_pending = HospitalStaff(user_id=u_staff_pending.id, hospital_id=h_a.id, role_title="Applicant", is_approved=False)
            sp_inactive = HospitalStaff(user_id=u_staff_inactive.id, hospital_id=h_a.id, role_title="Former Staff", is_approved=True)

            db.session.add_all([sp_a, sp_b, sp_pending, sp_inactive])
            db.session.commit()

            self.h_a_id = h_a.id
            self.h_b_id = h_b.id
            self.b_a1_id = b_a1.id
            self.b_a2_id = b_a2.id
            self.b_a3_id = b_a3.id
            self.b_b1_id = b_b1.id
            self.b_b2_id = b_b2.id

    def tearDown(self):
        with app.app_context():
            db.session.remove()
            db.drop_all()

    # 1. Public user can view public hospital availability
    def test_01_public_user_view_availability(self):
        res = self.client.get("/api/hospitals")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(len(data), 2)
        self.assertIn("available_beds", data[0])

    # 2. Public user cannot change bed occupancy
    def test_02_public_user_cannot_change_bed_occupancy(self):
        # Login as public user
        self.client.post("/api/auth/login/user", json={"email": "user@test.com", "password": "Password123!"})
        res = self.client.post(f"/api/beds/{self.b_a1_id}/admit", json={"patient_code": "ILLEGAL-PATIENT"})
        self.assertEqual(res.status_code, 403)
        self.assertIn("Access denied", res.get_json()["error"])

    # 3. Public user cannot generate operational bed QR codes
    def test_03_public_user_cannot_generate_qr(self):
        self.client.post("/api/auth/login/user", json={"email": "user@test.com", "password": "Password123!"})
        res = self.client.post(f"/api/beds/{self.b_a1_id}/qr")
        self.assertEqual(res.status_code, 403)

    # 4. Unapproved staff member cannot modify beds
    def test_04_unapproved_staff_cannot_modify_beds(self):
        # Attempt to login via hospital portal fails
        login_res = self.client.post("/api/auth/login/hospital", json={"email": "staff_pending@test.com", "password": "Password123!"})
        self.assertEqual(login_res.status_code, 403)
        self.assertIn("pending", login_res.get_json()["error"].lower())

    # 5. Hospital A staff can access their own hospital's authorized records
    def test_05_staff_a_can_access_own_hospital_records(self):
        self.client.post("/api/auth/login/hospital", json={"email": "staff_a@test.com", "password": "Password123!"})
        # Access Hospital A beds via staff endpoint
        res = self.client.get("/api/staff/beds")
        self.assertEqual(res.status_code, 200)
        beds = res.get_json()
        # All returned beds must belong to Hospital A
        for b in beds:
            self.assertEqual(b["hospital_id"], self.h_a_id)

    # 6. Hospital A staff cannot access Hospital B's protected records (multi-hospital isolation)
    def test_06_staff_a_cannot_access_hospital_b_protected_records(self):
        self.client.post("/api/auth/login/hospital", json={"email": "staff_a@test.com", "password": "Password123!"})
        # Server must enforce Hospital A assignment; client cannot pass hospital_id to inspect Hospital B
        res = self.client.get(f"/api/staff/beds?hospital_id={self.h_b_id}")
        self.assertEqual(res.status_code, 200)
        # Server returned beds must still belong to Hospital A (server ignores spoofed query param)
        for b in res.get_json():
            self.assertEqual(b["hospital_id"], self.h_a_id)

    # 7. Hospital A staff cannot change Hospital B's bed status
    def test_07_staff_a_cannot_change_hospital_b_bed_status(self):
        self.client.post("/api/auth/login/hospital", json={"email": "staff_a@test.com", "password": "Password123!"})
        # Try to admit Hospital B's bed
        res = self.client.post(f"/api/beds/{self.b_b1_id}/admit", json={"patient_code": "CROSS-HOSPITAL-ILLEGAL"})
        self.assertEqual(res.status_code, 403)
        self.assertIn("not authorized", res.get_json()["error"].lower())

    # 8. Editing hospital_id in request cannot bypass authorization
    def test_08_forged_hospital_id_in_request_rejected(self):
        self.client.post("/api/auth/login/hospital", json={"email": "staff_a@test.com", "password": "Password123!"})
        res = self.client.post(f"/api/beds/{self.b_b1_id}/admit", json={
            "patient_code": "FORGED-01",
            "hospital_id": self.h_a_id  # spoofing hospital_id in body
        })
        self.assertEqual(res.status_code, 403)

    # 9. Forged role in registration cannot grant admin access
    def test_09_forged_role_in_registration_fails(self):
        res = self.client.post("/api/auth/register", json={
            "name": "Attacker",
            "email": "attacker@test.com",
            "password": "Password123!",
            "confirm_password": "Password123!",
            "role": "admin"  # Malicious attempt to self-promote to admin
        })
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        # Role must be 'user', not 'admin'
        self.assertEqual(data["user"]["role"], "user")

    # 10. Unauthenticated request cannot change bed status
    def test_10_unauthenticated_request_cannot_change_bed_status(self):
        self.client.post("/api/auth/logout")
        res = self.client.post(f"/api/beds/{self.b_a1_id}/admit", json={"patient_code": "UNAUTH-P"})
        self.assertEqual(res.status_code, 401)

    # 11. Unauthorized QR scan (Hospital A staff scanning Hospital B bed) cannot modify bed
    def test_11_unauthorized_qr_scan_rejected(self):
        self.client.post("/api/auth/login/hospital", json={"email": "staff_a@test.com", "password": "Password123!"})
        # Staff A scanning bed belonging to Hospital B
        res = self.client.post("/api/demo/scan", json={
            "qr_payload": f"MEDILOC-BED:{self.b_b1_id}",
            "action": "admit",
            "patient_code": "QR-ILLEGAL"
        })
        self.assertEqual(res.status_code, 403)

    # 12. Deactivated staff account cannot perform protected operations
    def test_12_deactivated_staff_cannot_perform_operations(self):
        login_res = self.client.post("/api/auth/login/hospital", json={"email": "staff_inactive@test.com", "password": "Password123!"})
        self.assertEqual(login_res.status_code, 403)
        self.assertIn("deactivated", login_res.get_json()["error"].lower())

    # 13. Invalid bed-state transitions are rejected (Enforced lifecycle: Available -> Occupied -> Cleaning -> Available)
    def test_13_invalid_bed_state_transitions_rejected(self):
        self.client.post("/api/auth/login/hospital", json={"email": "staff_a@test.com", "password": "Password123!"})

        # Cannot discharge an Available bed
        res_dis = self.client.post(f"/api/beds/{self.b_a1_id}/discharge")
        self.assertEqual(res_dis.status_code, 409)

        # Cannot confirm clean an Occupied bed directly to Available
        res_clean = self.client.post(f"/api/beds/{self.b_a2_id}/confirm-clean")
        self.assertEqual(res_clean.status_code, 409)

        # Valid transition: Admit Available bed
        res_ok_admit = self.client.post(f"/api/beds/{self.b_a1_id}/admit", json={"patient_code": "PATIENT-VALID-01"})
        self.assertEqual(res_ok_admit.status_code, 200)
        self.assertEqual(res_ok_admit.get_json()["status"], "Occupied")

        # Valid transition: Discharge Occupied bed moves to Cleaning
        res_ok_dis = self.client.post(f"/api/beds/{self.b_a1_id}/discharge")
        self.assertEqual(res_ok_dis.status_code, 200)
        self.assertEqual(res_ok_dis.get_json()["status"], "Cleaning")

        # Valid transition: Cleaning -> Available
        res_ok_clean = self.client.post(f"/api/beds/{self.b_a1_id}/confirm-clean")
        self.assertEqual(res_ok_clean.status_code, 200)
        self.assertEqual(res_ok_clean.get_json()["status"], "Available")

    # 14. Successful actions generate the correct audit records
    def test_14_audit_records_generated(self):
        self.client.post("/api/auth/login/hospital", json={"email": "staff_a@test.com", "password": "Password123!"})
        self.client.post(f"/api/beds/{self.b_a1_id}/admit", json={"patient_code": "AUDIT-TEST-01"})

        with app.app_context():
            log = AuditLog.query.filter_by(bed_id=self.b_a1_id, action="admission").first()
            self.assertIsNotNone(log)
            self.assertEqual(log.hospital_id, self.h_a_id)
            self.assertEqual(log.actor_name, "Staff Hospital A")
            self.assertIn("AUDIT-TEST-01", log.details)

if __name__ == "__main__":
    unittest.main()
