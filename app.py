import os
import math
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, jsonify, request, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder="frontend", static_url_path="")
app.secret_key = os.getenv("SECRET_KEY", "mediloc-healthcare-secret-prototype-2026")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

def now_utc():
    return datetime.now(timezone.utc)

# Database Configuration
db_url = os.getenv("DATABASE_URL", "sqlite:///" + os.path.join(BASE_DIR, "mediloc.db"))
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)
app.config["SQLALCHEMY_DATABASE_URI"] = db_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

# ---------------------------------------------------------
# Geolocation & Distance Helpers
# ---------------------------------------------------------

PUNE_LOCALITY_COORDS = {
    "baner": (18.5590, 73.7868),
    "deccan": (18.5167, 73.8410),
    "shivajinagar": (18.5308, 73.8475),
    "kothrud": (18.5074, 73.8077),
    "aundh": (18.5600, 73.8070),
    "viman nagar": (18.5679, 73.9143),
    "hadapsar": (18.5089, 73.9260),
    "hinjawadi": (18.5913, 73.7389),
    "hinjewadi": (18.5913, 73.7389),
    "wakad": (18.5987, 73.7660),
    "pimpri": (18.6279, 73.8009),
    "chinchwad": (18.6298, 73.7997),
    "camp": (18.5163, 73.8796),
    "swargate": (18.5018, 73.8585),
    "kalyani nagar": (18.5463, 73.9034),
    "magarpatta": (18.5144, 73.9298),
    "kharadi": (18.5516, 73.9351),
    "bavdhan": (18.5158, 73.7707),
    "koregaon park": (18.5362, 73.8940),
    "pune": (18.5204, 73.8567),
    "pune city": (18.5204, 73.8567),
    "411045": (18.5590, 73.7868),  # Baner
    "411004": (18.5167, 73.8410),  # Deccan
    "411005": (18.5308, 73.8475),  # Shivajinagar
    "411038": (18.5074, 73.8077),  # Kothrud
    "411007": (18.5600, 73.8070),  # Aundh
    "411014": (18.5679, 73.9143),  # Viman Nagar
    "411028": (18.5089, 73.9260),  # Hadapsar
    "411057": (18.5913, 73.7389),  # Hinjawadi
}

def haversine_distance(lat1, lon1, lat2, lon2):
    try:
        if None in (lat1, lon1, lat2, lon2):
            return None
        lat1, lon1, lat2, lon2 = float(lat1), float(lon1), float(lat2), float(lon2)
        r = 6371.0  # Earth radius in kilometers
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (math.sin(dlat / 2) ** 2 +
             math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
             math.sin(dlon / 2) ** 2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return round(r * c, 2)
    except Exception:
        return None

def resolve_location_coordinates(locality, city="Pune", pincode=""):
    for query in [locality, pincode, f"{locality} {city}"]:
        if query:
            clean = query.lower().strip()
            for key, coords in PUNE_LOCALITY_COORDS.items():
                if key in clean:
                    return coords[0], coords[1]
    return 18.5204, 73.8567

# ---------------------------------------------------------
# Database Models
# ---------------------------------------------------------

class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(140), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(20), default="user")  # 'user', 'staff', 'admin'
    is_active = db.Column(db.Boolean, default=True)  # Active / Deactivated
    city = db.Column(db.String(80), default="Pune")
    locality = db.Column(db.String(120), default="")
    pincode = db.Column(db.String(20), default="")
    address = db.Column(db.String(250), default="")
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, default=now_utc)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "role": self.role,
            "is_active": self.is_active,
            "city": self.city or "",
            "locality": self.locality or "",
            "pincode": self.pincode or "",
            "address": self.address or "",
            "latitude": self.latitude,
            "longitude": self.longitude,
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None
        }

class Hospital(db.Model):
    __tablename__ = "hospitals"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    address = db.Column(db.String(250), nullable=False)
    city = db.Column(db.String(80), default="Pune")
    locality = db.Column(db.String(120), default="")
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    phone = db.Column(db.String(40), default="")
    is_demo = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=now_utc)
    updated_at = db.Column(db.DateTime, default=now_utc, onupdate=now_utc)

    beds = db.relationship("Bed", backref="hospital", lazy=True, cascade="all, delete-orphan")

    def to_dict(self, user_lat=None, user_lng=None):
        bed_list = self.beds
        total = len(bed_list)
        available = sum(1 for b in bed_list if b.status == "Available")
        occupied = sum(1 for b in bed_list if b.status == "Occupied")
        cleaning = sum(1 for b in bed_list if b.status == "Cleaning")
        icu_avail = sum(1 for b in bed_list if b.category == "ICU" and b.status == "Available")
        gen_avail = sum(1 for b in bed_list if b.category != "ICU" and b.status == "Available")
        dist = haversine_distance(user_lat, user_lng, self.latitude, self.longitude)

        latest_update = self.updated_at
        for b in bed_list:
            if b.updated_at and (latest_update is None or b.updated_at > latest_update):
                latest_update = b.updated_at

        return {
            "id": self.id,
            "name": self.name,
            "address": self.address,
            "city": self.city,
            "locality": self.locality,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "phone": self.phone,
            "is_demo": self.is_demo,
            "total_beds": total,
            "available_beds": available,
            "occupied_beds": occupied,
            "cleaning_beds": cleaning,
            "icu_available": icu_avail,
            "general_available": gen_avail,
            "distance_km": dist,
            "updated_at": latest_update.isoformat() + "Z" if latest_update else None
        }

class HospitalStaff(db.Model):
    __tablename__ = "hospital_staff"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), unique=True, nullable=False)
    hospital_id = db.Column(db.Integer, db.ForeignKey("hospitals.id"), nullable=False)
    role_title = db.Column(db.String(80), default="Duty Officer / Staff Nurse")
    is_approved = db.Column(db.Boolean, default=False)  # Requires administrator approval!
    created_at = db.Column(db.DateTime, default=now_utc)

    user = db.relationship("User", backref=db.backref("staff_profile", uselist=False))
    hospital = db.relationship("Hospital", backref="staff_members")

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "user_name": self.user.name if self.user else "",
            "user_email": self.user.email if self.user else "",
            "user_is_active": self.user.is_active if self.user else False,
            "hospital_id": self.hospital_id,
            "hospital_name": self.hospital.name if self.hospital else "",
            "role_title": self.role_title,
            "is_approved": self.is_approved,
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None
        }

class Bed(db.Model):
    __tablename__ = "beds"
    id = db.Column(db.Integer, primary_key=True)
    hospital_id = db.Column(db.Integer, db.ForeignKey("hospitals.id"), nullable=False)
    label = db.Column(db.String(40), nullable=False)
    category = db.Column(db.String(40), default="General")  # General, ICU, Emergency, Pediatric
    ward = db.Column(db.String(80), default="Ward A")
    status = db.Column(db.String(20), default="Available")  # Available, Occupied, Cleaning
    patient_code = db.Column(db.String(80), nullable=True)
    updated_at = db.Column(db.DateTime, default=now_utc, onupdate=now_utc)

    def to_dict(self, include_patient=False):
        return {
            "id": self.id,
            "hospital_id": self.hospital_id,
            "hospital": self.hospital.name if self.hospital else "",
            "label": self.label,
            "category": self.category,
            "ward": self.ward,
            "status": self.status,
            "patient_code": self.patient_code if include_patient else (
                "●●●●" if self.patient_code else None
            ),
            "updated_at": self.updated_at.isoformat() + "Z" if self.updated_at else None
        }

class CleaningRecord(db.Model):
    __tablename__ = "cleaning_records"
    id = db.Column(db.Integer, primary_key=True)
    bed_id = db.Column(db.Integer, db.ForeignKey("beds.id"), nullable=False)
    hospital_id = db.Column(db.Integer, db.ForeignKey("hospitals.id"), nullable=False)
    status = db.Column(db.String(30), default="Pending")  # Pending, In Progress, Completed, Needs Re-cleaning
    requested_at = db.Column(db.DateTime, default=now_utc)
    completed_at = db.Column(db.DateTime, nullable=True)
    staff_name = db.Column(db.String(100), default="Housekeeping Team")
    notes = db.Column(db.String(250), default="")

    bed = db.relationship("Bed", backref="cleaning_records")
    hospital = db.relationship("Hospital", backref="cleaning_records")

    def to_dict(self):
        return {
            "id": self.id,
            "bed_id": self.bed_id,
            "bed_label": self.bed.label if self.bed else f"Bed {self.bed_id}",
            "ward": self.bed.ward if self.bed else "",
            "hospital_id": self.hospital_id,
            "hospital_name": self.hospital.name if self.hospital else "",
            "status": self.status,
            "requested_at": self.requested_at.isoformat() + "Z" if self.requested_at else None,
            "completed_at": self.completed_at.isoformat() + "Z" if self.completed_at else None,
            "staff_name": self.staff_name,
            "notes": self.notes
        }

class AuditLog(db.Model):
    __tablename__ = "audit_logs"
    id = db.Column(db.Integer, primary_key=True)
    hospital_id = db.Column(db.Integer, db.ForeignKey("hospitals.id"), nullable=False)
    bed_id = db.Column(db.Integer, nullable=True)
    bed_label = db.Column(db.String(40), default="")
    action = db.Column(db.String(40), nullable=False)
    actor_name = db.Column(db.String(100), nullable=False)
    actor_role = db.Column(db.String(40), default="Staff")
    details = db.Column(db.String(250), default="")
    timestamp = db.Column(db.DateTime, default=now_utc)

    def to_dict(self):
        return {
            "id": self.id,
            "hospital_id": self.hospital_id,
            "bed_id": self.bed_id,
            "bed_label": self.bed_label,
            "action": self.action,
            "actor_name": self.actor_name,
            "actor_role": self.actor_role,
            "details": self.details,
            "timestamp": self.timestamp.isoformat() + "Z" if self.timestamp else None
        }

class Notification(db.Model):
    __tablename__ = "notifications"
    id = db.Column(db.Integer, primary_key=True)
    hospital_id = db.Column(db.Integer, nullable=True)
    user_id = db.Column(db.Integer, nullable=True)
    title = db.Column(db.String(120), nullable=False)
    message = db.Column(db.String(300), nullable=False)
    type = db.Column(db.String(30), default="info")
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=now_utc)

    def to_dict(self):
        return {
            "id": self.id,
            "hospital_id": self.hospital_id,
            "title": self.title,
            "message": self.message,
            "type": self.type,
            "is_read": self.is_read,
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None
        }

# ---------------------------------------------------------
# Security & Authorization Helpers
# ---------------------------------------------------------

def get_current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    user = db.session.get(User, user_id)
    if not user or not user.is_active:
        return None
    return user

def get_current_staff():
    """
    Returns (user, staff_profile) only if:
    1. User is authenticated and active.
    2. User is 'staff' or 'admin'.
    3. If 'staff', account MUST be approved (is_approved=True).
    """
    user = get_current_user()
    if not user:
        return None, None
    if user.role == "admin":
        return user, None
    if user.role != "staff":
        return None, None

    staff_profile = HospitalStaff.query.filter_by(user_id=user.id).first()
    if not staff_profile or not staff_profile.is_approved:
        return None, None
    return user, staff_profile

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Authentication required. Please sign in."}), 401
        return f(*args, **kwargs)
    return decorated

def staff_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Staff authentication required. Please sign in to the Hospital Portal."}), 401
        if user.role not in ["staff", "admin"]:
            return jsonify({"error": "Access denied. Public users cannot access hospital staff operations."}), 403

        if user.role == "staff":
            staff_profile = HospitalStaff.query.filter_by(user_id=user.id).first()
            if not staff_profile:
                return jsonify({"error": "No hospital profile assigned to this staff account."}), 403
            if not staff_profile.is_approved:
                return jsonify({"error": "Staff account pending administrator approval. Operational access denied."}), 403

        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Administrator authentication required."}), 401
        if user.role != "admin":
            return jsonify({"error": "Forbidden. Administrator privileges required."}), 403
        return f(*args, **kwargs)
    return decorated

def verify_hospital_access(hospital_id, user, staff_profile):
    """
    Strict multi-hospital data isolation check.
    Returns None if authorized, or (error_json, status_code) tuple if unauthorized.
    """
    if user.role == "admin":
        return None
    if not staff_profile:
        return jsonify({"error": "Hospital authorization profile missing."}), 403
    if not staff_profile.is_approved:
        return jsonify({"error": "Staff account is unapproved. Access denied."}), 403
    if staff_profile.hospital_id != hospital_id:
        return jsonify({"error": "Forbidden. You are not authorized to access or modify records for another hospital."}), 403
    return None

def verify_bed_access(bed, user, staff_profile):
    return verify_hospital_access(bed.hospital_id, user, staff_profile)

# ---------------------------------------------------------
# Seed Data
# ---------------------------------------------------------

def seed_demo_data():
    if Hospital.query.first():
        return

    # Seed 6 Pune demonstration hospitals
    hospitals_seed = [
        {
            "name": "Mediloc City Care Demo Hospital",
            "address": "Fergusson College Road, Deccan Gymkhana, Pune, Maharashtra 411004",
            "city": "Pune", "locality": "Deccan Gymkhana",
            "latitude": 18.5167, "longitude": 73.8410,
            "phone": "+91 98230 11001",
            "wards": [
                {"name": "ICU Block A", "category": "ICU", "beds": 4, "occupied": [1, 3], "cleaning": []},
                {"name": "General Ward 1", "category": "General", "beds": 6, "occupied": [2, 5], "cleaning": [4]},
                {"name": "Emergency Ward", "category": "Emergency", "beds": 4, "occupied": [2], "cleaning": []}
            ]
        },
        {
            "name": "Mediloc Riverside Demo Medical Centre",
            "address": "University Road, Shivajinagar, Pune, Maharashtra 411005",
            "city": "Pune", "locality": "Shivajinagar",
            "latitude": 18.5308, "longitude": 73.8475,
            "phone": "+91 98230 11002",
            "wards": [
                {"name": "ICU Unit 1", "category": "ICU", "beds": 3, "occupied": [1], "cleaning": []},
                {"name": "General Ward North", "category": "General", "beds": 6, "occupied": [3, 4], "cleaning": [2]},
                {"name": "Pediatric Ward", "category": "Pediatric", "beds": 3, "occupied": [], "cleaning": []}
            ]
        },
        {
            "name": "Mediloc Greenfield Demo Hospital",
            "address": "Paud Road, Kothrud, Pune, Maharashtra 411038",
            "city": "Pune", "locality": "Kothrud",
            "latitude": 18.5074, "longitude": 73.8077,
            "phone": "+91 98230 11003",
            "wards": [
                {"name": "ICU Ward B", "category": "ICU", "beds": 3, "occupied": [2], "cleaning": [1]},
                {"name": "General Ward East", "category": "General", "beds": 5, "occupied": [1, 4], "cleaning": []},
                {"name": "Specialty Care", "category": "Emergency", "beds": 2, "occupied": [1], "cleaning": []}
            ]
        },
        {
            "name": "Mediloc Northstar Demo Clinic",
            "address": "ITI Road, Aundh, Pune, Maharashtra 411007",
            "city": "Pune", "locality": "Aundh",
            "latitude": 18.5600, "longitude": 73.8070,
            "phone": "+91 98230 11004",
            "wards": [
                {"name": "ICU Unit", "category": "ICU", "beds": 2, "occupied": [1], "cleaning": []},
                {"name": "General Ward West", "category": "General", "beds": 5, "occupied": [2], "cleaning": [3]}
            ]
        },
        {
            "name": "Mediloc Apex Super Specialty Hospital",
            "address": "Symbiosis Road, Viman Nagar, Pune, Maharashtra 411014",
            "city": "Pune", "locality": "Viman Nagar",
            "latitude": 18.5679, "longitude": 73.9143,
            "phone": "+91 98230 11005",
            "wards": [
                {"name": "Critical Care ICU", "category": "ICU", "beds": 4, "occupied": [1, 2, 4], "cleaning": []},
                {"name": "General Wing 2", "category": "General", "beds": 8, "occupied": [3, 5, 7], "cleaning": [6]}
            ]
        },
        {
            "name": "Mediloc Metro Wellness Hospital",
            "address": "Magarpatta Road, Hadapsar, Pune, Maharashtra 411028",
            "city": "Pune", "locality": "Hadapsar",
            "latitude": 18.5089, "longitude": 73.9260,
            "phone": "+91 98230 11006",
            "wards": [
                {"name": "Intensive Care Unit", "category": "ICU", "beds": 3, "occupied": [1], "cleaning": []},
                {"name": "General Care Ward", "category": "General", "beds": 6, "occupied": [2, 4], "cleaning": [5]}
            ]
        }
    ]

    hosp_instances = []
    for h_data in hospitals_seed:
        h = Hospital(
            name=h_data["name"],
            address=h_data["address"],
            city=h_data["city"],
            locality=h_data["locality"],
            latitude=h_data["latitude"],
            longitude=h_data["longitude"],
            phone=h_data["phone"],
            is_demo=True
        )
        db.session.add(h)
        db.session.flush()
        hosp_instances.append(h)

        bed_counter = 1
        for w in h_data["wards"]:
            for b_idx in range(1, w["beds"] + 1):
                status = "Available"
                p_code = None
                if b_idx in w["occupied"]:
                    status = "Occupied"
                    p_code = f"DEMO-{h.id:02d}-{bed_counter:03d}"
                elif b_idx in w["cleaning"]:
                    status = "Cleaning"

                bed = Bed(
                    hospital_id=h.id,
                    label=f"BED-{h.id:02d}-{bed_counter:02d}",
                    category=w["category"],
                    ward=w["name"],
                    status=status,
                    patient_code=p_code
                )
                db.session.add(bed)
                db.session.flush()

                if status == "Cleaning":
                    clean_rec = CleaningRecord(
                        bed_id=bed.id,
                        hospital_id=h.id,
                        status="Pending",
                        staff_name="Housekeeping Team",
                        notes="Discharge sanitization routine requested."
                    )
                    db.session.add(clean_rec)

                bed_counter += 1

    # ---------------------------------------------------------
    # Seed Distinct Accounts: Public Citizen, Separate Staff, Admin
    # ---------------------------------------------------------

    # 1. Public Citizen User (Baner, Pune)
    user_citizen = User(
        name="Ananya Sharma",
        email="user@mediloc.demo",
        password_hash=generate_password_hash("DemoUser123!"),
        role="user",
        is_active=True,
        city="Pune",
        locality="Baner",
        pincode="411045",
        address="Near Pancard Club Road, Baner",
        latitude=18.5590,
        longitude=73.7868
    )
    db.session.add(user_citizen)

    # 2. Staff Account A -> Assigned to Hospital 1 (Deccan) ONLY
    staff_deccan_user = User(
        name="Dr. Rajesh Kulkarni",
        email="staff.deccan@mediloc.demo",
        password_hash=generate_password_hash("DeccanStaff123!"),
        role="staff",
        is_active=True,
        city="Pune",
        locality="Deccan Gymkhana",
        pincode="411004"
    )
    db.session.add(staff_deccan_user)
    db.session.flush()

    staff_deccan_profile = HospitalStaff(
        user_id=staff_deccan_user.id,
        hospital_id=hosp_instances[0].id,  # Hospital 1
        role_title="Duty Medical Officer (Deccan)",
        is_approved=True
    )
    db.session.add(staff_deccan_profile)

    # 3. Staff Account B -> Assigned to Hospital 2 (Shivajinagar) ONLY
    staff_shivaji_user = User(
        name="Nurse Priya Deshmukh",
        email="staff.shivaji@mediloc.demo",
        password_hash=generate_password_hash("ShivajiStaff123!"),
        role="staff",
        is_active=True,
        city="Pune",
        locality="Shivajinagar",
        pincode="411005"
    )
    db.session.add(staff_shivaji_user)
    db.session.flush()

    staff_shivaji_profile = HospitalStaff(
        user_id=staff_shivaji_user.id,
        hospital_id=hosp_instances[1].id,  # Hospital 2
        role_title="Bed Manager (Shivajinagar)",
        is_approved=True
    )
    db.session.add(staff_shivaji_profile)

    # 4. Staff Account C -> Assigned to Hospital 3 (Kothrud) ONLY
    staff_kothrud_user = User(
        name="Dr. Amit Patil",
        email="staff.kothrud@mediloc.demo",
        password_hash=generate_password_hash("KothrudStaff123!"),
        role="staff",
        is_active=True,
        city="Pune",
        locality="Kothrud",
        pincode="411038"
    )
    db.session.add(staff_kothrud_user)
    db.session.flush()

    staff_kothrud_profile = HospitalStaff(
        user_id=staff_kothrud_user.id,
        hospital_id=hosp_instances[2].id,  # Hospital 3
        role_title="Senior Registrar (Kothrud)",
        is_approved=True
    )
    db.session.add(staff_kothrud_profile)

    # 5. Unapproved Staff Account (for security tests and onboarding demos)
    staff_pending_user = User(
        name="Dr. Neha Gokhale",
        email="staff.pending@mediloc.demo",
        password_hash=generate_password_hash("PendingStaff123!"),
        role="staff",
        is_active=True,
        city="Pune",
        locality="Aundh",
        pincode="411007"
    )
    db.session.add(staff_pending_user)
    db.session.flush()

    staff_pending_profile = HospitalStaff(
        user_id=staff_pending_user.id,
        hospital_id=hosp_instances[3].id,  # Hospital 4
        role_title="Applicant Duty Doctor",
        is_approved=False  # NOT APPROVED
    )
    db.session.add(staff_pending_profile)

    # 6. Deactivated Staff Account (for security verification)
    staff_inactive_user = User(
        name="Former Staff Ramesh",
        email="staff.inactive@mediloc.demo",
        password_hash=generate_password_hash("InactiveStaff123!"),
        role="staff",
        is_active=False,  # DEACTIVATED
        city="Pune"
    )
    db.session.add(staff_inactive_user)
    db.session.flush()

    staff_inactive_profile = HospitalStaff(
        user_id=staff_inactive_user.id,
        hospital_id=hosp_instances[0].id,
        role_title="Suspended Officer",
        is_approved=True
    )
    db.session.add(staff_inactive_profile)

    # 7. System Administrator
    user_admin = User(
        name="Mediloc Administrator",
        email=os.getenv("ADMIN_EMAIL", "admin@mediloc.demo"),
        password_hash=generate_password_hash(os.getenv("ADMIN_PASSWORD", "DemoAdmin123!")),
        role="admin",
        is_active=True,
        city="Pune",
        locality="Shivajinagar",
        pincode="411005"
    )
    db.session.add(user_admin)

    # Initial Audit Logs
    audit1 = AuditLog(
        hospital_id=hosp_instances[0].id,
        bed_id=1,
        bed_label="BED-01-01",
        action="admission",
        actor_name="Dr. Rajesh Kulkarni",
        actor_role="staff",
        details="Patient DEMO-01-001 admitted to ICU Block A"
    )
    audit2 = AuditLog(
        hospital_id=hosp_instances[1].id,
        bed_id=15,
        bed_label="BED-02-01",
        action="admission",
        actor_name="Nurse Priya Deshmukh",
        actor_role="staff",
        details="Patient admitted into Shivajinagar ICU Unit 1"
    )
    db.session.add(audit1)
    db.session.add(audit2)

    db.session.commit()

# ---------------------------------------------------------
# Static File Routes
# ---------------------------------------------------------

@app.get("/")
def home():
    return send_from_directory(app.static_folder, "index.html")

@app.get("/login/user")
@app.get("/login/hospital")
def login_portal_routes():
    return send_from_directory(app.static_folder, "index.html")

@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "Mediloc Healthcare Multi-Tenant Security API",
        "timestamp": now_utc().isoformat()
    })

# ---------------------------------------------------------
# Authentication Endpoints (Two-Portal Architecture)
# ---------------------------------------------------------

@app.post("/api/auth/register")
def register():
    """
    Public Citizen Registration.
    Strictly forces role='user' to prevent privilege escalation!
    """
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).lower().strip()
    password = str(data.get("password", ""))
    confirm_password = str(data.get("confirm_password", ""))
    city = str(data.get("city", "Pune")).strip() or "Pune"
    locality = str(data.get("locality", "")).strip()
    pincode = str(data.get("pincode", "")).strip()
    address = str(data.get("address", "")).strip()

    if not name:
        return jsonify({"error": "Full name is required."}), 400
    if not email or "@" not in email:
        return jsonify({"error": "A valid email address is required."}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters long."}), 400
    if password != confirm_password:
        return jsonify({"error": "Passwords do not match."}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({"error": "An account with this email address already exists. Please sign in."}), 409

    latitude = data.get("latitude")
    longitude = data.get("longitude")
    if latitude is None or longitude is None:
        lat, lon = resolve_location_coordinates(locality, city, pincode)
        latitude, longitude = lat, lon

    # SECURITY: Role is unconditionally set to 'user'. Client cannot set 'admin' or 'staff'.
    user = User(
        name=name,
        email=email,
        password_hash=generate_password_hash(password),
        role="user",
        is_active=True,
        city=city,
        locality=locality,
        pincode=pincode,
        address=address,
        latitude=latitude,
        longitude=longitude
    )
    db.session.add(user)
    db.session.commit()

    session["user_id"] = user.id
    return jsonify({
        "message": "User account created successfully.",
        "portal": "user",
        "user": user.to_dict()
    }), 201

@app.post("/api/auth/login/user")
def login_user():
    """Option A: Citizen Portal Login."""
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).lower().strip()
    password = str(data.get("password", ""))

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    user = User.query.filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid email or password."}), 401

    if not user.is_active:
        return jsonify({"error": "Account is inactive or suspended."}), 403

    session["user_id"] = user.id
    return jsonify({
        "message": "Citizen login successful.",
        "portal": "user",
        "user": user.to_dict()
    })

@app.post("/api/auth/login/hospital")
def login_hospital():
    """Option B: Hospital Staff Portal Login."""
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).lower().strip()
    password = str(data.get("password", ""))

    if not email or not password:
        return jsonify({"error": "Hospital email and password are required."}), 400

    user = User.query.filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid hospital credentials."}), 401

    if not user.is_active:
        return jsonify({"error": "Hospital staff account has been deactivated. Contact your administrator."}), 403

    if user.role not in ["staff", "admin"]:
        return jsonify({"error": "Access denied. Public citizen accounts cannot sign in through the Hospital Staff portal."}), 403

    staff_profile = None
    if user.role == "staff":
        staff_profile = HospitalStaff.query.filter_by(user_id=user.id).first()
        if not staff_profile:
            return jsonify({"error": "Staff profile not assigned to any hospital. Contact administrator."}), 403
        if not staff_profile.is_approved:
            return jsonify({"error": "Staff account pending administrative approval. Operational access is denied."}), 403

    session["user_id"] = user.id

    return jsonify({
        "message": "Hospital staff authenticated successfully.",
        "portal": "hospital",
        "user": user.to_dict(),
        "staff_profile": staff_profile.to_dict() if staff_profile else {
            "hospital_id": None, "hospital_name": "All Hospitals (Admin Oversight)", "role_title": "System Administrator", "is_approved": True
        }
    })

@app.post("/api/auth/login")
def login_generic():
    """Unified login handler that routes appropriately."""
    portal = request.args.get("portal", "")
    if portal == "hospital":
        return login_hospital()
    if portal == "user":
        return login_user()

    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).lower().strip()
    password = str(data.get("password", ""))

    user = User.query.filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid email or password."}), 401
    if not user.is_active:
        return jsonify({"error": "Account is inactive."}), 403

    session["user_id"] = user.id
    staff_profile = None
    if user.role in ["staff", "admin"]:
        sp = HospitalStaff.query.filter_by(user_id=user.id).first()
        if sp:
            staff_profile = sp.to_dict()

    return jsonify({
        "message": "Signed in successfully.",
        "portal": "hospital" if user.role in ["staff", "admin"] else "user",
        "user": user.to_dict(),
        "staff_profile": staff_profile
    })

@app.post("/api/auth/logout")
def logout():
    session.pop("user_id", None)
    return jsonify({"message": "Logged out successfully."})

@app.get("/api/auth/me")
def me():
    user = get_current_user()
    if not user:
        return jsonify({"authenticated": False, "user": None, "portal": None})

    staff_profile = None
    if user.role in ["staff", "admin"]:
        sp = HospitalStaff.query.filter_by(user_id=user.id).first()
        if sp:
            staff_profile = sp.to_dict()

    return jsonify({
        "authenticated": True,
        "portal": "hospital" if user.role in ["staff", "admin"] else "user",
        "user": user.to_dict(),
        "staff_profile": staff_profile
    })

@app.put("/api/auth/profile")
@login_required
def update_profile():
    user = get_current_user()
    data = request.get_json(silent=True) or {}

    if "name" in data and data["name"].strip():
        user.name = data["name"].strip()
    if "city" in data:
        user.city = data["city"].strip() or user.city
    if "locality" in data:
        user.locality = data["locality"].strip()
    if "pincode" in data:
        user.pincode = data["pincode"].strip()
    if "address" in data:
        user.address = data["address"].strip()

    if "latitude" in data and "longitude" in data and data["latitude"] is not None:
        user.latitude = float(data["latitude"])
        user.longitude = float(data["longitude"])
    elif user.locality or user.pincode:
        lat, lon = resolve_location_coordinates(user.locality, user.city, user.pincode)
        user.latitude, user.longitude = lat, lon

    db.session.commit()
    return jsonify({
        "message": "Profile and location updated successfully.",
        "user": user.to_dict()
    })

@app.get("/api/geocode")
def geocode_lookup():
    q = request.args.get("q", "").strip()
    city = request.args.get("city", "Pune").strip()
    if not q:
        return jsonify({"error": "Query parameter q is required."}), 400
    lat, lon = resolve_location_coordinates(q, city)
    return jsonify({"query": q, "city": city, "latitude": lat, "longitude": lon, "label": f"{q}, {city}"})

# ---------------------------------------------------------
# Public Hospital Directory Endpoints (Read-Only)
# ---------------------------------------------------------

@app.get("/api/hospitals")
def get_hospitals():
    user = get_current_user()
    user_lat = request.args.get("lat", type=float)
    user_lng = request.args.get("lng", type=float)

    if (user_lat is None or user_lng is None) and user and user.latitude and user.longitude:
        user_lat = user.latitude
        user_lng = user.longitude

    search = request.args.get("search", "").lower().strip()
    locality_filter = request.args.get("locality", "").lower().strip()
    available_only = request.args.get("available_only", "").lower() in ["1", "true", "yes"]
    icu_only = request.args.get("icu_only", "").lower() in ["1", "true", "yes"]
    sort_by = request.args.get("sort", "distance" if (user_lat and user_lng) else "name")

    query = Hospital.query
    results = []

    for h in query.all():
        if search and search not in h.name.lower() and search not in h.address.lower() and search not in h.locality.lower():
            continue
        if locality_filter and locality_filter not in h.locality.lower() and locality_filter not in h.address.lower():
            continue

        h_dict = h.to_dict(user_lat=user_lat, user_lng=user_lng)
        if available_only and h_dict["available_beds"] == 0:
            continue
        if icu_only and h_dict["icu_available"] == 0:
            continue

        results.append(h_dict)

    if sort_by == "distance" and user_lat and user_lng:
        results.sort(key=lambda x: (x["distance_km"] if x["distance_km"] is not None else 9999))
    elif sort_by == "available":
        results.sort(key=lambda x: x["available_beds"], reverse=True)
    elif sort_by == "icu":
        results.sort(key=lambda x: x["icu_available"], reverse=True)
    else:
        results.sort(key=lambda x: x["name"])

    return jsonify(results)

@app.get("/api/hospitals/<int:hospital_id>")
def get_hospital_details(hospital_id):
    h = db.get_or_404(Hospital, hospital_id)
    user = get_current_user()
    user_lat = request.args.get("lat", type=float) or (user.latitude if user else None)
    user_lng = request.args.get("lng", type=float) or (user.longitude if user else None)

    h_data = h.to_dict(user_lat=user_lat, user_lng=user_lng)

    wards = {}
    beds_data = []
    # Patient code is ONLY unmasked if user is staff assigned to this exact hospital or admin
    is_authorized_staff = False
    if user and user.role == "admin":
        is_authorized_staff = True
    elif user and user.role == "staff":
        sp = HospitalStaff.query.filter_by(user_id=user.id).first()
        if sp and sp.is_approved and sp.hospital_id == h.id:
            is_authorized_staff = True

    for b in h.beds:
        b_dict = b.to_dict(include_patient=is_authorized_staff)
        beds_data.append(b_dict)
        w_name = b.ward or "General Ward"
        if w_name not in wards:
            wards[w_name] = {"name": w_name, "category": b.category, "total": 0, "available": 0, "occupied": 0, "cleaning": 0}
        wards[w_name]["total"] += 1
        if b.status == "Available":
            wards[w_name]["available"] += 1
        elif b.status == "Occupied":
            wards[w_name]["occupied"] += 1
        elif b.status == "Cleaning":
            wards[w_name]["cleaning"] += 1

    h_data["wards"] = list(wards.values())
    h_data["beds"] = beds_data
    return jsonify(h_data)

@app.get("/api/beds")
def get_public_beds():
    """Read-only view of beds for directory display (patient code always masked for public)."""
    hospital_id = request.args.get("hospital_id", type=int)
    category = request.args.get("category", "").strip()
    status = request.args.get("status", "").strip()
    search = request.args.get("search", "").strip()

    user = get_current_user()
    query = Bed.query
    if hospital_id:
        query = query.filter_by(hospital_id=hospital_id)
    if category:
        query = query.filter_by(category=category)
    if status:
        query = query.filter_by(status=status)

    beds_list = query.order_by(Bed.hospital_id, Bed.id).all()
    if search:
        beds_list = [b for b in beds_list if search.lower() in b.label.lower()]

    # Public users NEVER see unmasked patient codes
    return jsonify([b.to_dict(include_patient=False) for b in beds_list])

# ---------------------------------------------------------
# Hospital Staff Portal APIs (Multi-Hospital Isolation)
# ---------------------------------------------------------

@app.get("/api/staff/beds")
@staff_required
def get_staff_beds():
    """
    Returns beds for the staff member's ASSIGNED hospital only.
    Server ignores any client-supplied hospital_id to prevent IDOR!
    """
    user, staff_profile = get_current_staff()
    h_id = staff_profile.hospital_id if staff_profile else request.args.get("hospital_id", type=int)

    query = Bed.query
    if h_id:
        query = query.filter_by(hospital_id=h_id)

    category = request.args.get("category", "").strip()
    status = request.args.get("status", "").strip()
    search = request.args.get("search", "").strip()

    if category:
        query = query.filter_by(category=category)
    if status:
        query = query.filter_by(status=status)

    beds_list = query.order_by(Bed.id).all()
    if search:
        beds_list = [b for b in beds_list if search.lower() in b.label.lower()]

    return jsonify([b.to_dict(include_patient=True) for b in beds_list])

@app.post("/api/beds/<int:bed_id>/admit")
@staff_required
def admit_patient(bed_id):
    user, staff_profile = get_current_staff()
    bed = db.get_or_404(Bed, bed_id)

    # Multi-hospital authorization check
    auth_err = verify_bed_access(bed, user, staff_profile)
    if auth_err:
        return auth_err

    data = request.get_json(silent=True) or {}
    patient_code = str(data.get("patient_code", "")).strip()

    if bed.status != "Available":
        return jsonify({"error": f"Invalid transition: Bed {bed.label} is currently {bed.status.lower()} and cannot be admitted."}), 409

    if not patient_code:
        patient_code = f"DEMO-{bed.hospital_id:02d}-{int(datetime.now().timestamp()) % 1000:03d}"

    bed.status = "Occupied"
    bed.patient_code = patient_code[:80]
    bed.updated_at = now_utc()

    audit = AuditLog(
        hospital_id=bed.hospital_id,
        bed_id=bed.id,
        bed_label=bed.label,
        action="admission",
        actor_name=user.name,
        actor_role=user.role,
        details=f"Patient {bed.patient_code} admitted into {bed.ward} ({bed.label})"
    )
    db.session.add(audit)

    notif = Notification(
        hospital_id=bed.hospital_id,
        title=f"Bed Admitted: {bed.label}",
        message=f"{bed.label} in {bed.ward} has been occupied with patient {bed.patient_code}.",
        type="admission"
    )
    db.session.add(notif)
    db.session.commit()

    return jsonify(bed.to_dict(include_patient=True))

@app.post("/api/beds/<int:bed_id>/discharge")
@staff_required
def discharge_patient(bed_id):
    user, staff_profile = get_current_staff()
    bed = db.get_or_404(Bed, bed_id)

    # Multi-hospital authorization check
    auth_err = verify_bed_access(bed, user, staff_profile)
    if auth_err:
        return auth_err

    if bed.status != "Occupied":
        return jsonify({"error": f"Invalid transition: Bed {bed.label} is {bed.status.lower()} and cannot be discharged."}), 409

    old_patient = bed.patient_code or "Unknown"

    # Mandatory healthcare rule: Occupied -> Cleaning, NEVER directly Available
    bed.status = "Cleaning"
    bed.patient_code = None
    bed.updated_at = now_utc()

    cleaning = CleaningRecord(
        bed_id=bed.id,
        hospital_id=bed.hospital_id,
        status="Pending",
        staff_name="Housekeeping Team",
        notes=f"Discharge sanitization required after patient {old_patient}."
    )
    db.session.add(cleaning)

    audit = AuditLog(
        hospital_id=bed.hospital_id,
        bed_id=bed.id,
        bed_label=bed.label,
        action="discharge",
        actor_name=user.name,
        actor_role=user.role,
        details=f"Patient {old_patient} discharged from {bed.label}. Bed moved to Cleaning queue."
    )
    db.session.add(audit)

    notif = Notification(
        hospital_id=bed.hospital_id,
        title=f"Bed Discharged: {bed.label}",
        message=f"{bed.label} discharged and moved to Cleaning queue.",
        type="discharge"
    )
    db.session.add(notif)
    db.session.commit()

    return jsonify(bed.to_dict(include_patient=True))

@app.post("/api/beds/<int:bed_id>/cleaning-status")
@staff_required
def update_cleaning_status(bed_id):
    user, staff_profile = get_current_staff()
    bed = db.get_or_404(Bed, bed_id)

    auth_err = verify_bed_access(bed, user, staff_profile)
    if auth_err:
        return auth_err

    if bed.status != "Cleaning":
        return jsonify({"error": f"Bed {bed.label} is currently {bed.status.lower()}, not in cleaning status."}), 409

    data = request.get_json(silent=True) or {}
    new_status = str(data.get("status", "")).strip()

    record = CleaningRecord.query.filter_by(bed_id=bed.id, hospital_id=bed.hospital_id).order_by(CleaningRecord.id.desc()).first()
    if not record or record.completed_at is not None:
        record = CleaningRecord(bed_id=bed.id, hospital_id=bed.hospital_id, status="Pending")
        db.session.add(record)

    record.status = new_status
    if new_status == "Completed":
        record.completed_at = now_utc()
    record.notes = str(data.get("notes", record.notes or ""))

    audit = AuditLog(
        hospital_id=bed.hospital_id,
        bed_id=bed.id,
        bed_label=bed.label,
        action=f"cleaning_{new_status.lower().replace(' ', '_')}",
        actor_name=user.name,
        actor_role=user.role,
        details=f"Bed {bed.label} sanitization updated to '{new_status}'"
    )
    db.session.add(audit)
    db.session.commit()

    return jsonify(record.to_dict())

@app.post("/api/beds/<int:bed_id>/clean")
@app.post("/api/beds/<int:bed_id>/confirm-clean")
@staff_required
def confirm_cleaning_completed(bed_id):
    user, staff_profile = get_current_staff()
    bed = db.get_or_404(Bed, bed_id)

    auth_err = verify_bed_access(bed, user, staff_profile)
    if auth_err:
        return auth_err

    if bed.status != "Cleaning":
        return jsonify({"error": f"Invalid transition: Bed {bed.label} is {bed.status.lower()} and not in Cleaning status."}), 409

    bed.status = "Available"
    bed.patient_code = None
    bed.updated_at = now_utc()

    record = CleaningRecord.query.filter_by(bed_id=bed.id, hospital_id=bed.hospital_id).order_by(CleaningRecord.id.desc()).first()
    if record:
        record.status = "Completed"
        if not record.completed_at:
            record.completed_at = now_utc()

    audit = AuditLog(
        hospital_id=bed.hospital_id,
        bed_id=bed.id,
        bed_label=bed.label,
        action="cleaning_confirmed",
        actor_name=user.name,
        actor_role=user.role,
        details=f"Sanitization approved for {bed.label}. Bed released to Available."
    )
    db.session.add(audit)

    notif = Notification(
        hospital_id=bed.hospital_id,
        title=f"Bed Ready: {bed.label}",
        message=f"{bed.label} in {bed.ward} is sanitized and marked Available for admission.",
        type="cleaning"
    )
    db.session.add(notif)
    db.session.commit()

    return jsonify(bed.to_dict(include_patient=True))

@app.post("/api/beds/<int:bed_id>/qr")
@staff_required
def generate_bed_qr(bed_id):
    """Generates QR identifier only for staff authorized for this hospital."""
    user, staff_profile = get_current_staff()
    bed = db.get_or_404(Bed, bed_id)

    auth_err = verify_bed_access(bed, user, staff_profile)
    if auth_err:
        return auth_err

    payload = f"MEDILOC-BED:{bed.id}"
    return jsonify({
        "bed_id": bed.id,
        "hospital_id": bed.hospital_id,
        "hospital_name": bed.hospital.name,
        "ward": bed.ward,
        "label": bed.label,
        "status": bed.status,
        "qr_payload": payload
    })

@app.post("/api/demo/scan")
@staff_required
def scan_bed_qr():
    """
    Staff QR Scan Processor.
    Strictly verifies bed belongs to staff member's assigned hospital!
    """
    user, staff_profile = get_current_staff()
    data = request.get_json(silent=True) or {}
    raw = str(data.get("qr_payload", "")).strip()

    try:
        if raw.startswith("MEDILOC-BED:"):
            bed_id = int(raw.split(":")[-1])
        else:
            bed_id = int(raw)
    except (ValueError, TypeError):
        return jsonify({"error": "Unrecognized QR code format. Expected a valid Mediloc bed identifier."}), 400

    bed = db.get_or_404(Bed, bed_id)

    # Multi-hospital authorization check
    auth_err = verify_bed_access(bed, user, staff_profile)
    if auth_err:
        return auth_err

    action = data.get("action")
    if not action:
        next_action = "admit" if bed.status == "Available" else ("discharge" if bed.status == "Occupied" else "clean")
        return jsonify({
            "valid": True,
            "bed": bed.to_dict(include_patient=True),
            "status": bed.status,
            "next_action": next_action,
            "allowed_actions": ["admit"] if bed.status == "Available" else (["discharge"] if bed.status == "Occupied" else ["clean"])
        })

    if action == "admit":
        return admit_patient(bed.id)
    if action == "discharge":
        return discharge_patient(bed.id)
    if action in ["clean", "confirm-clean"]:
        return confirm_cleaning_completed(bed.id)

    return jsonify({"error": "Invalid action. Must be admit, discharge, or clean."}), 400

@app.get("/api/staff/cleaning-queue")
@staff_required
def get_staff_cleaning_queue():
    user, staff_profile = get_current_staff()
    h_id = staff_profile.hospital_id if staff_profile else request.args.get("hospital_id", type=int)

    query = CleaningRecord.query
    if h_id:
        query = query.filter_by(hospital_id=h_id)
    records = query.order_by(CleaningRecord.id.desc()).limit(50).all()
    return jsonify([r.to_dict() for r in records])

@app.get("/api/staff/audit-logs")
@staff_required
def get_staff_audit_logs():
    user, staff_profile = get_current_staff()
    h_id = staff_profile.hospital_id if staff_profile else request.args.get("hospital_id", type=int)

    query = AuditLog.query
    if h_id:
        query = query.filter_by(hospital_id=h_id)
    logs = query.order_by(AuditLog.id.desc()).limit(60).all()
    return jsonify([log.to_dict() for log in logs])

@app.get("/api/staff/stats")
@staff_required
def get_staff_stats():
    user, staff_profile = get_current_staff()
    h_id = staff_profile.hospital_id if staff_profile else request.args.get("hospital_id", type=int)

    query = Bed.query
    if h_id:
        query = query.filter_by(hospital_id=h_id)
    beds_list = query.all()

    total = len(beds_list)
    available = sum(1 for b in beds_list if b.status == "Available")
    occupied = sum(1 for b in beds_list if b.status == "Occupied")
    cleaning = sum(1 for b in beds_list if b.status == "Cleaning")
    icu_avail = sum(1 for b in beds_list if b.category == "ICU" and b.status == "Available")

    log_query = AuditLog.query
    if h_id:
        log_query = log_query.filter_by(hospital_id=h_id)
    recent_logs = log_query.order_by(AuditLog.id.desc()).limit(100).all()

    admissions_count = sum(1 for log in recent_logs if log.action == "admission")
    discharges_count = sum(1 for log in recent_logs if log.action == "discharge")

    return jsonify({
        "hospital_id": h_id,
        "total_beds": total,
        "available_beds": available,
        "occupied_beds": occupied,
        "cleaning_beds": cleaning,
        "icu_available": icu_avail,
        "recent_admissions": admissions_count,
        "recent_discharges": discharges_count
    })

@app.get("/api/notifications")
def get_notifications():
    user = get_current_user()
    h_id = None
    if user and user.role == "staff":
        sp = HospitalStaff.query.filter_by(user_id=user.id).first()
        if sp:
            h_id = sp.hospital_id

    query = Notification.query
    if h_id:
        query = query.filter((Notification.hospital_id == h_id) | (Notification.hospital_id.is_(None)))
    elif user and user.role == "admin":
        pass
    else:
        # Public or regular citizen gets global notifications
        query = query.filter(Notification.hospital_id.is_(None))

    notifs = query.order_by(Notification.id.desc()).limit(30).all()
    return jsonify([n.to_dict() for n in notifs])

# ---------------------------------------------------------
# Administrator Workflow Endpoints
# ---------------------------------------------------------

@app.get("/api/admin/staff")
@admin_required
def admin_list_staff():
    """Lists all staff accounts, approval status, and hospital assignment."""
    staff_list = HospitalStaff.query.all()
    return jsonify([s.to_dict() for s in staff_list])

@app.post("/api/admin/staff/<int:staff_id>/approve")
@admin_required
def admin_approve_staff(staff_id):
    sp = db.get_or_404(HospitalStaff, staff_id)
    sp.is_approved = True
    db.session.commit()
    return jsonify({"message": f"Staff account for {sp.user.name} approved.", "staff": sp.to_dict()})

@app.post("/api/admin/staff/<int:staff_id>/toggle-active")
@admin_required
def admin_toggle_staff_active(staff_id):
    sp = db.get_or_404(HospitalStaff, staff_id)
    user = sp.user
    user.is_active = not user.is_active
    db.session.commit()
    return jsonify({"message": f"Staff account active status set to {user.is_active}.", "is_active": user.is_active})

@app.post("/api/admin/staff/<int:staff_id>/assign-hospital")
@admin_required
def admin_assign_hospital(staff_id):
    sp = db.get_or_404(HospitalStaff, staff_id)
    data = request.get_json(silent=True) or {}
    new_h_id = int(data.get("hospital_id", 0))
    hospital = db.get_or_404(Hospital, new_h_id)

    sp.hospital_id = hospital.id
    db.session.commit()
    return jsonify({"message": f"Staff {sp.user.name} reassigned to {hospital.name}.", "staff": sp.to_dict()})

@app.post("/api/admin/hospitals")
@admin_required
def admin_create_hospital():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    address = str(data.get("address", "")).strip()
    city = str(data.get("city", "Pune")).strip()
    locality = str(data.get("locality", "")).strip()
    lat = float(data.get("latitude", 18.5204))
    lng = float(data.get("longitude", 73.8567))
    phone = str(data.get("phone", "")).strip()

    if not name or not address:
        return jsonify({"error": "Name and address are required."}), 400

    h = Hospital(name=name, address=address, city=city, locality=locality, latitude=lat, longitude=lng, phone=phone, is_demo=False)
    db.session.add(h)
    db.session.commit()
    return jsonify(h.to_dict()), 201

# ---------------------------------------------------------
# Frontend Catch-All
# ---------------------------------------------------------

@app.get("/<path:path>")
def frontend_files(path):
    full_path = os.path.join(app.static_folder, path)
    if os.path.isfile(full_path):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")

# ---------------------------------------------------------
# Initialization
# ---------------------------------------------------------

with app.app_context():
    db.create_all()
    seed_demo_data()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug_mode = os.getenv("FLASK_DEBUG", "True").lower() in ["true", "1", "yes"]
    app.run(host="0.0.0.0", port=port, debug=debug_mode)
