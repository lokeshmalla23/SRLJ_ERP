from dotenv import load_dotenv
from pathlib import Path

# LEGACY / QUARANTINED — Electron and production use Node Express (backend/src/index.js).
# Do not start this FastAPI/Mongo server. See docs/legacy-python-quarantine.md.

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import logging
import uuid
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta, date
from typing import Optional, List, Dict, Any, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

# ---------------- Config ----------------
JWT_ALGORITHM = "HS256"
JWT_EXPIRES_MIN = 60 * 24 * 7  # 7 days for premium ERP experience


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


# ---------------- Mongo ----------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ---------------- App ----------------
app = FastAPI(title="Aurum ERP")
api = APIRouter(prefix="/api")
bearer_scheme = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("aurum")


# =====================================================================
# CONSTANTS: Roles, Modules, Permissions
# =====================================================================
ROLES = [
    "shop_owner",
    "manager",
    "accountant",
    "cashier",
    "inventory_manager",
    "sales_executive",
    "gold_scheme_manager",
    "repair_manager",
]

MODULES = [
    "dashboard",
    "inventory",
    "catalog",
    "pos",
    "customers",
    "gold_schemes",
    "reports",
    "settings",
    "users",
]

ACTIONS = ["view", "create", "edit", "delete", "export", "import", "manage"]

# Default role -> permission mapping. Shop owner gets everything.
def default_permissions_for_role(role: str) -> Dict[str, List[str]]:
    if role == "shop_owner":
        return {m: ACTIONS[:] for m in MODULES}
    if role == "manager":
        return {
            "dashboard": ["view"],
            "inventory": ["view", "create", "edit", "export", "import"],
            "catalog": ["view", "create", "edit"],
            "pos": ["view", "create", "edit"],
            "customers": ["view", "create", "edit", "export"],
            "gold_schemes": ["view", "create", "edit"],
            "reports": ["view", "export"],
            "settings": ["view"],
            "users": ["view"],
        }
    if role == "accountant":
        return {
            "dashboard": ["view"],
            "reports": ["view", "export"],
            "customers": ["view"],
            "pos": ["view"],
            "gold_schemes": ["view"],
        }
    if role == "cashier":
        return {
            "dashboard": ["view"],
            "pos": ["view", "create"],
            "customers": ["view", "create"],
            "inventory": ["view"],
        }
    if role == "inventory_manager":
        return {
            "dashboard": ["view"],
            "inventory": ACTIONS[:],
            "catalog": ACTIONS[:],
            "reports": ["view"],
        }
    if role == "sales_executive":
        return {
            "dashboard": ["view"],
            "pos": ["view", "create"],
            "customers": ["view", "create", "edit"],
            "inventory": ["view"],
        }
    if role == "gold_scheme_manager":
        return {
            "dashboard": ["view"],
            "gold_schemes": ACTIONS[:],
            "customers": ["view", "create", "edit"],
        }
    if role == "repair_manager":
        return {
            "dashboard": ["view"],
            "customers": ["view"],
        }
    return {}


# =====================================================================
# Auth helpers
# =====================================================================
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRES_MIN),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    token = None
    if creds and creds.credentials:
        token = creds.credentials
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user.pop("_id", None)
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_permission(module: str, action: str):
    async def checker(user: dict = Depends(get_current_user)):
        if user.get("role") == "shop_owner":
            return user
        perms = user.get("permissions") or {}
        allowed = perms.get(module, [])
        if action not in allowed:
            raise HTTPException(status_code=403, detail=f"Missing permission: {module}:{action}")
        return user

    return checker


# =====================================================================
# Models
# =====================================================================
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: EmailStr
    name: str
    role: str
    permissions: Dict[str, List[str]] = {}
    active: bool = True
    created_at: str


class UserCreateIn(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: str
    permissions: Optional[Dict[str, List[str]]] = None
    active: bool = True


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    permissions: Optional[Dict[str, List[str]]] = None
    active: Optional[bool] = None
    password: Optional[str] = None


class ProductIn(BaseModel):
    name: str
    code: Optional[str] = None
    barcode: Optional[str] = None
    # Dynamic catalog references
    category_id: Optional[str] = None
    subcategory_id: Optional[str] = None
    collection_ids: List[str] = []
    tag_ids: List[str] = []
    metal_type_id: Optional[str] = None
    purity_id: Optional[str] = None
    stone_type_ids: List[str] = []
    unit_id: Optional[str] = None
    # Custom attribute values keyed by attribute code (dynamic per category)
    attribute_values: Dict[str, Any] = {}
    # Base weights & charges
    gross_weight: float = 0.0
    net_weight: float = 0.0
    stone_weight: float = 0.0
    making_charges: float = 0.0
    making_charge_type: str = "flat"  # flat | per_gram | percentage
    wastage_pct: float = 0.0
    hallmark: Optional[str] = None
    hsn_code: Optional[str] = "7113"  # default jewellery HSN
    gst_slab: float = 3.0  # % — default 3% for jewellery
    purchase_price: float = 0.0
    selling_price: float = 0.0
    stock_qty: int = 0
    low_stock_threshold: int = 3
    image_url: Optional[str] = None
    description: Optional[str] = None


class ProductOut(ProductIn):
    id: str
    created_at: str
    updated_at: str


# ---------- Dynamic catalog models ----------
class CategoryIn(BaseModel):
    name: str
    description: Optional[str] = None
    parent_id: Optional[str] = None  # None = top-level; else subcategory
    icon: Optional[str] = None
    display_order: int = 0


class AttributeIn(BaseModel):
    name: str
    code: str  # slug for storing in product.attribute_values
    field_type: str  # text|number|dropdown|multiselect|date|image|boolean|color|price|weight
    options: List[str] = []  # for dropdown / multiselect
    required: bool = False
    unit: Optional[str] = None  # e.g. "mm", "g" for weight/number fields
    category_ids: List[str] = []  # applies to which categories/subcategories
    display_order: int = 0
    help_text: Optional[str] = None


class LookupIn(BaseModel):
    """Generic lookup: collections, tags, metal_types, stone_types, purities, units."""
    name: str
    code: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    meta: Dict[str, Any] = {}


class CustomerIn(BaseModel):
    name: str
    mobile: str
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    gst_number: Optional[str] = None
    dob: Optional[str] = None
    anniversary: Optional[str] = None
    tag: Optional[str] = "regular"  # vip, regular, wholesale
    notes: Optional[str] = None


class CustomerOut(CustomerIn):
    id: str
    total_purchases: float = 0.0
    loyalty_points: int = 0
    created_at: str


class InvoiceItemIn(BaseModel):
    product_id: str
    name: str
    metal: str
    purity: str
    hsn_code: Optional[str] = "7113"
    gross_weight: float = 0.0
    net_weight: float = 0.0
    making_charges: float = 0.0
    wastage_pct: float = 0.0
    rate: float = 0.0  # gold rate per gram at time of sale
    quantity: int = 1
    unit_price: float  # total price for this item before tax
    discount: float = 0.0


class PaymentIn(BaseModel):
    mode: str  # cash, upi, card, bank_transfer
    amount: float
    reference: Optional[str] = None


class InvoiceIn(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_mobile: Optional[str] = None
    items: List[InvoiceItemIn]
    subtotal: float
    discount: float = 0.0
    gst_pct: float = 3.0
    gst_amount: float
    grand_total: float
    payments: List[PaymentIn]
    notes: Optional[str] = None


class InvoiceOut(InvoiceIn):
    id: str
    invoice_no: str
    status: str = "paid"  # paid, refunded, cancelled
    created_at: str
    created_by: str


class SchemeIn(BaseModel):
    customer_id: str
    customer_name: str
    customer_mobile: Optional[str] = None
    plan_name: str  # e.g. "11+1 Gold Plan"
    monthly_amount: float
    duration_months: int = 12
    start_date: str  # yyyy-mm-dd
    notes: Optional[str] = None


class SchemePaymentIn(BaseModel):
    amount: float
    mode: str = "cash"
    reference: Optional[str] = None


class GoldRateIn(BaseModel):
    gold_22k: float
    gold_18k: float
    gold_24k: float
    silver: float


# =====================================================================
# Startup: indexes + seed
# =====================================================================
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.products.create_index("id", unique=True)
    await db.products.create_index("barcode")
    await db.customers.create_index("id", unique=True)
    await db.customers.create_index("mobile")
    await db.invoices.create_index("id", unique=True)
    await db.invoices.create_index("invoice_no", unique=True)
    await db.schemes.create_index("id", unique=True)
    await db.settings.create_index("key", unique=True)
    for coll in ("categories", "collections", "tags", "metal_types", "stone_types", "purities", "units", "attributes"):
        await db[coll].create_index("id", unique=True)

    # Seed owner
    admin_email = os.environ.get("ADMIN_EMAIL", "owner@aurum.jewellery").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "Aurum@2026")
    admin_name = os.environ.get("ADMIN_NAME", "Shop Owner")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        doc = {
            "id": new_id(),
            "email": admin_email,
            "name": admin_name,
            "password_hash": hash_password(admin_password),
            "role": "shop_owner",
            "permissions": default_permissions_for_role("shop_owner"),
            "active": True,
            "created_at": now_iso(),
        }
        await db.users.insert_one(doc)
        logger.info(f"Seeded shop owner: {admin_email}")
    else:
        # keep password in sync with env
        if not verify_password(admin_password, existing.get("password_hash", "")):
            await db.users.update_one(
                {"email": admin_email},
                {"$set": {"password_hash": hash_password(admin_password)}},
            )

    # Seed default settings
    if not await db.settings.find_one({"key": "company"}):
        await db.settings.insert_one(
            {
                "key": "company",
                "value": {
                    "name": os.environ.get("SHOP_NAME", "Aurum Jewellers"),
                    "tagline": "Heirloom-grade craftsmanship since 1974",
                    "address": "12, Zaveri Bazaar, Mumbai 400002",
                    "phone": "+91 98200 12345",
                    "email": admin_email,
                    "gst_number": "27AAAAA0000A1Z5",
                    "currency": "INR",
                    "invoice_prefix": "AUR",
                },
            }
        )

    if not await db.settings.find_one({"key": "gold_rate"}):
        await db.settings.insert_one(
            {
                "key": "gold_rate",
                "value": {
                    "gold_22k": 6580.0,
                    "gold_18k": 5390.0,
                    "gold_24k": 7180.0,
                    "silver": 92.0,
                    "updated_at": now_iso(),
                },
            }
        )

    # ---------- Seed catalog master data (idempotent) ----------
    catalog_first_run = await db.categories.count_documents({}) == 0

    if catalog_first_run:
        # Wipe products from old schema - user chose reseed
        await db.products.delete_many({})

        # Lookups
        metal_types = [
            {"name": "Gold", "code": "gold", "color": "#B49042"},
            {"name": "Silver", "code": "silver", "color": "#9CA3AF"},
            {"name": "Platinum", "code": "platinum", "color": "#6B7280"},
            {"name": "Diamond", "code": "diamond", "color": "#60A5FA"},
        ]
        purities = [
            {"name": "24K", "code": "24k", "meta": {"metal": "gold", "purity": 999}},
            {"name": "22K (BIS 916)", "code": "22k", "meta": {"metal": "gold", "purity": 916}},
            {"name": "18K", "code": "18k", "meta": {"metal": "gold", "purity": 750}},
            {"name": "14K", "code": "14k", "meta": {"metal": "gold", "purity": 585}},
            {"name": "Sterling 925", "code": "925", "meta": {"metal": "silver", "purity": 925}},
            {"name": "PT950", "code": "pt950", "meta": {"metal": "platinum", "purity": 950}},
        ]
        stones = [
            {"name": "Diamond"}, {"name": "Ruby"}, {"name": "Emerald"},
            {"name": "Sapphire"}, {"name": "Pearl"}, {"name": "Kundan"},
            {"name": "Polki"}, {"name": "Uncut Diamond"},
        ]
        units = [
            {"name": "Piece", "code": "pc"},
            {"name": "Gram", "code": "g"},
            {"name": "Pair", "code": "pair"},
            {"name": "Set", "code": "set"},
        ]
        collections = [
            {"name": "Bridal Heritage"}, {"name": "Solitaire"}, {"name": "Temple"},
            {"name": "Everyday"}, {"name": "Gentleman"}, {"name": "Silver Heritage"},
            {"name": "Festival"}, {"name": "Kids"},
        ]
        tags = [
            {"name": "New Arrival"}, {"name": "Best Seller"}, {"name": "Limited Edition"},
            {"name": "Wedding"}, {"name": "Gift"},
        ]

        async def _seed_lookup(coll, items):
            for it in items:
                doc = {
                    "id": new_id(),
                    "code": it.get("code") or it["name"].lower().replace(" ", "_"),
                    "description": it.get("description"),
                    "color": it.get("color"),
                    "meta": it.get("meta", {}),
                    "name": it["name"],
                    "created_at": now_iso(),
                }
                await db[coll].insert_one(doc)

        await _seed_lookup("metal_types", metal_types)
        await _seed_lookup("purities", purities)
        await _seed_lookup("stone_types", stones)
        await _seed_lookup("units", units)
        await _seed_lookup("collections", collections)
        await _seed_lookup("tags", tags)

        # Categories with parent_id = None (top-level) and subcategories
        top_categories = [
            ("Rings", ["Engagement", "Solitaire", "Couple", "Daily Wear", "Bridal", "Designer"]),
            ("Necklaces", ["Bridal", "Choker", "Long Chain", "Layered"]),
            ("Earrings", ["Studs", "Jhumka", "Hoops", "Danglers"]),
            ("Bangles", ["Kada", "Bridal Set", "Kundan"]),
            ("Chains", ["Box", "Rope", "Cuban", "Snake"]),
            ("Anklets", ["Classic", "Bridal", "Kids"]),
            ("Pendants", ["Solitaire", "Religious", "Fashion"]),
        ]
        cat_map: Dict[str, str] = {}
        sub_map: Dict[tuple, str] = {}
        for order, (cat_name, subs) in enumerate(top_categories):
            cid = new_id()
            cat_map[cat_name] = cid
            await db.categories.insert_one({
                "id": cid,
                "name": cat_name,
                "parent_id": None,
                "description": f"{cat_name} category",
                "display_order": order,
                "created_at": now_iso(),
            })
            for sorder, sname in enumerate(subs):
                sid = new_id()
                sub_map[(cat_name, sname)] = sid
                await db.categories.insert_one({
                    "id": sid,
                    "name": sname,
                    "parent_id": cid,
                    "description": f"{sname} {cat_name.lower()}",
                    "display_order": sorder,
                    "created_at": now_iso(),
                })

        # Attributes attached to categories
        attrs_spec = [
            # rings
            {"name": "Ring Size", "code": "ring_size", "field_type": "dropdown",
             "options": ["6", "7", "8", "9", "10", "11", "12", "13", "14"],
             "categories": ["Rings"]},
            {"name": "Gender", "code": "gender", "field_type": "dropdown",
             "options": ["Women", "Men", "Unisex", "Kids"],
             "categories": ["Rings", "Chains", "Bangles"]},
            {"name": "Occasion", "code": "occasion", "field_type": "multiselect",
             "options": ["Wedding", "Party", "Daily", "Festival", "Gift"],
             "categories": ["Rings", "Necklaces", "Earrings", "Pendants"]},
            # chains
            {"name": "Length", "code": "length", "field_type": "number",
             "unit": "in", "categories": ["Chains", "Anklets", "Necklaces"]},
            {"name": "Lock Type", "code": "lock_type", "field_type": "dropdown",
             "options": ["S-Hook", "Spring", "Box", "Screw"],
             "categories": ["Chains", "Necklaces", "Anklets"]},
            # bangles
            {"name": "Bangle Size", "code": "bangle_size", "field_type": "dropdown",
             "options": ["2.2", "2.4", "2.6", "2.8", "2.10"],
             "categories": ["Bangles"]},
            {"name": "Pair or Single", "code": "pair_single", "field_type": "dropdown",
             "options": ["Single", "Pair"],
             "categories": ["Bangles", "Earrings", "Anklets"]},
            # earrings
            {"name": "Back Type", "code": "back_type", "field_type": "dropdown",
             "options": ["Push", "Screw", "Hook", "Clip"],
             "categories": ["Earrings"]},
            # general
            {"name": "Certified", "code": "certified", "field_type": "boolean",
             "categories": []},
            {"name": "Certification Number", "code": "cert_no", "field_type": "text",
             "categories": []},
        ]
        for order, a in enumerate(attrs_spec):
            cat_ids = [cat_map[c] for c in a["categories"] if c in cat_map]
            await db.attributes.insert_one({
                "id": new_id(),
                "name": a["name"],
                "code": a["code"],
                "field_type": a["field_type"],
                "options": a.get("options", []),
                "required": False,
                "unit": a.get("unit"),
                "category_ids": cat_ids,
                "display_order": order,
                "help_text": None,
                "created_at": now_iso(),
            })

        # Lookup helpers
        async def _first(coll, filt):
            return await db[coll].find_one(filt)
        gold = await _first("metal_types", {"code": "gold"})
        silver = await _first("metal_types", {"code": "silver"})
        p22 = await _first("purities", {"code": "22k"})
        p18 = await _first("purities", {"code": "18k"})
        p925 = await _first("purities", {"code": "925"})
        unit_pc = await _first("units", {"code": "pc"})
        bridal = await _first("collections", {"name": "Bridal Heritage"})
        solit = await _first("collections", {"name": "Solitaire"})
        temple = await _first("collections", {"name": "Temple"})
        everyday = await _first("collections", {"name": "Everyday"})
        gent = await _first("collections", {"name": "Gentleman"})
        silverc = await _first("collections", {"name": "Silver Heritage"})
        diamond_stone = await _first("stone_types", {"name": "Diamond"})
        kundan_stone = await _first("stone_types", {"name": "Kundan"})

        sample_products = [
            {
                "name": "Solitaire Diamond Ring",
                "category_id": cat_map["Rings"], "subcategory_id": sub_map[("Rings", "Solitaire")],
                "metal_type_id": gold["id"], "purity_id": p18["id"], "unit_id": unit_pc["id"],
                "collection_ids": [solit["id"]], "stone_type_ids": [diamond_stone["id"]],
                "gross_weight": 4.2, "net_weight": 3.8, "stone_weight": 0.4,
                "making_charges": 4500, "wastage_pct": 8,
                "purchase_price": 62000, "selling_price": 78500, "stock_qty": 4,
                "hallmark": "BIS 916", "hsn_code": "7113",
                "attribute_values": {"ring_size": "8", "gender": "Women", "occasion": ["Wedding"], "certified": True},
                "image_url": "https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=400",
            },
            {
                "name": "Kundan Bridal Necklace",
                "category_id": cat_map["Necklaces"], "subcategory_id": sub_map[("Necklaces", "Bridal")],
                "metal_type_id": gold["id"], "purity_id": p22["id"], "unit_id": unit_pc["id"],
                "collection_ids": [bridal["id"]], "stone_type_ids": [kundan_stone["id"]],
                "gross_weight": 48.5, "net_weight": 44.2, "stone_weight": 4.3,
                "making_charges": 22000, "wastage_pct": 12,
                "purchase_price": 328000, "selling_price": 412000, "stock_qty": 2,
                "hallmark": "BIS 916", "hsn_code": "7113",
                "attribute_values": {"length": 18, "lock_type": "S-Hook", "occasion": ["Wedding", "Festival"]},
                "image_url": "https://images.pexels.com/photos/19564918/pexels-photo-19564918.jpeg?w=400",
            },
            {
                "name": "Classic Gold Chain 22\"",
                "category_id": cat_map["Chains"], "subcategory_id": sub_map[("Chains", "Rope")],
                "metal_type_id": gold["id"], "purity_id": p22["id"], "unit_id": unit_pc["id"],
                "collection_ids": [everyday["id"]],
                "gross_weight": 12.8, "net_weight": 12.8,
                "making_charges": 3200, "wastage_pct": 6,
                "purchase_price": 82000, "selling_price": 96500, "stock_qty": 8,
                "hallmark": "BIS 916", "hsn_code": "7113",
                "attribute_values": {"length": 22, "lock_type": "Spring", "gender": "Unisex"},
            },
            {
                "name": "Diamond Stud Earrings",
                "category_id": cat_map["Earrings"], "subcategory_id": sub_map[("Earrings", "Studs")],
                "metal_type_id": gold["id"], "purity_id": p18["id"], "unit_id": unit_pc["id"],
                "collection_ids": [solit["id"]], "stone_type_ids": [diamond_stone["id"]],
                "gross_weight": 3.1, "net_weight": 2.6, "stone_weight": 0.5,
                "making_charges": 5200, "wastage_pct": 7,
                "purchase_price": 44000, "selling_price": 58900, "stock_qty": 6,
                "hallmark": "IGI Certified", "hsn_code": "7113",
                "attribute_values": {"back_type": "Push", "pair_single": "Pair", "certified": True},
                "image_url": "https://images.pexels.com/photos/2849742/pexels-photo-2849742.jpeg?w=400",
            },
            {
                "name": "Temple Jhumka",
                "category_id": cat_map["Earrings"], "subcategory_id": sub_map[("Earrings", "Jhumka")],
                "metal_type_id": gold["id"], "purity_id": p22["id"], "unit_id": unit_pc["id"],
                "collection_ids": [temple["id"]],
                "gross_weight": 18.4, "net_weight": 18.4,
                "making_charges": 8500, "wastage_pct": 10,
                "purchase_price": 122000, "selling_price": 148500, "stock_qty": 3,
                "hallmark": "BIS 916", "hsn_code": "7113",
                "attribute_values": {"back_type": "Hook", "pair_single": "Pair"},
            },
            {
                "name": "Antique Silver Anklet",
                "category_id": cat_map["Anklets"], "subcategory_id": sub_map[("Anklets", "Classic")],
                "metal_type_id": silver["id"], "purity_id": p925["id"], "unit_id": unit_pc["id"],
                "collection_ids": [silverc["id"]],
                "gross_weight": 42.0, "net_weight": 42.0,
                "making_charges": 800, "wastage_pct": 4,
                "purchase_price": 4200, "selling_price": 5600, "stock_qty": 12,
                "hallmark": "925 Sterling", "hsn_code": "7113",
                "attribute_values": {"length": 10, "pair_single": "Pair"},
            },
            {
                "name": "Polki Bangle Set",
                "category_id": cat_map["Bangles"], "subcategory_id": sub_map[("Bangles", "Kundan")],
                "metal_type_id": gold["id"], "purity_id": p22["id"], "unit_id": unit_pc["id"],
                "collection_ids": [bridal["id"]],
                "gross_weight": 62.0, "net_weight": 56.4, "stone_weight": 5.6,
                "making_charges": 28000, "wastage_pct": 12,
                "purchase_price": 428000, "selling_price": 528000, "stock_qty": 1,
                "hallmark": "BIS 916", "hsn_code": "7113",
                "attribute_values": {"bangle_size": "2.6", "pair_single": "Pair", "gender": "Women"},
            },
            {
                "name": "Men's Signet Ring",
                "category_id": cat_map["Rings"], "subcategory_id": sub_map[("Rings", "Designer")],
                "metal_type_id": gold["id"], "purity_id": p22["id"], "unit_id": unit_pc["id"],
                "collection_ids": [gent["id"]],
                "gross_weight": 9.2, "net_weight": 9.2,
                "making_charges": 4800, "wastage_pct": 8,
                "purchase_price": 62000, "selling_price": 74500, "stock_qty": 5,
                "hallmark": "BIS 916", "hsn_code": "7113",
                "attribute_values": {"ring_size": "10", "gender": "Men"},
            },
        ]
        for p in sample_products:
            p["id"] = new_id()
            p["code"] = "AUR-" + p["id"][:6].upper()
            p["barcode"] = "890" + p["id"].replace("-", "")[:10]
            p["low_stock_threshold"] = 3
            p["gst_slab"] = 3.0
            p["making_charge_type"] = "flat"
            p["tag_ids"] = []
            p["created_at"] = now_iso()
            p["updated_at"] = now_iso()
            await db.products.insert_one(p)

    if await db.customers.count_documents({}) == 0:
        samples = [
            {"name": "Aditi Sharma", "mobile": "9821012345", "email": "aditi@example.com", "tag": "vip", "address": "Malabar Hill, Mumbai", "gst_number": None},
            {"name": "Rahul Verma", "mobile": "9820023456", "email": "rahul@example.com", "tag": "regular", "address": "Bandra West, Mumbai"},
            {"name": "Priya Iyer", "mobile": "9819034567", "email": "priya@example.com", "tag": "vip", "address": "Juhu, Mumbai"},
            {"name": "Karan Kapoor", "mobile": "9818045678", "email": "karan@example.com", "tag": "regular", "address": "Powai, Mumbai"},
            {"name": "Meera Nair", "mobile": "9817056789", "email": "meera@example.com", "tag": "wholesale", "address": "Andheri East, Mumbai"},
        ]
        for c in samples:
            c["id"] = new_id()
            c["total_purchases"] = 0.0
            c["loyalty_points"] = 0
            c["created_at"] = now_iso()
            await db.customers.insert_one(c)

    # write test creds
    creds_path = Path("/app/memory")
    creds_path.mkdir(parents=True, exist_ok=True)
    with open(creds_path / "test_credentials.md", "w") as f:
        f.write(
            f"""# Test Credentials — Aurum ERP

## Shop Owner (full access)
- Email: `{admin_email}`
- Password: `{admin_password}`
- Role: shop_owner

## Endpoints (all prefixed with `/api`)
- POST /api/auth/login { { "email", "password" } }
- GET  /api/auth/me
- GET  /api/dashboard/summary
- GET  /api/products
- GET  /api/customers
- GET  /api/schemes
- GET  /api/invoices
- GET  /api/users
- GET  /api/settings/company
- GET  /api/settings/gold-rate
"""
        )


# =====================================================================
# Auth endpoints
# =====================================================================
@api.post("/auth/login")
async def login(data: LoginIn):
    user = await db.users.find_one({"email": data.email.lower()})
    if not user or not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Account is disabled")
    token = create_access_token(user["id"], user["email"])
    user.pop("_id", None)
    user.pop("password_hash", None)
    return {"access_token": token, "token_type": "bearer", "user": user}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# =====================================================================
# Meta
# =====================================================================
@api.get("/meta/roles")
async def meta_roles(user: dict = Depends(get_current_user)):
    return {"roles": ROLES, "modules": MODULES, "actions": ACTIONS}


@api.get("/meta/default-permissions/{role}")
async def meta_default_perms(role: str, user: dict = Depends(get_current_user)):
    if role not in ROLES:
        raise HTTPException(404, "Unknown role")
    return default_permissions_for_role(role)


# =====================================================================
# Users
# =====================================================================
def _serialize(doc):
    if not doc:
        return doc
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


@api.get("/users")
async def list_users(user: dict = Depends(require_permission("users", "view"))):
    users = await db.users.find({}).sort("created_at", -1).to_list(500)
    return [_serialize(u) for u in users]


@api.post("/users")
async def create_user(payload: UserCreateIn, user: dict = Depends(require_permission("users", "create"))):
    if payload.role not in ROLES:
        raise HTTPException(400, "Invalid role")
    existing = await db.users.find_one({"email": payload.email.lower()})
    if existing:
        raise HTTPException(400, "Email already exists")
    perms = payload.permissions or default_permissions_for_role(payload.role)
    doc = {
        "id": new_id(),
        "email": payload.email.lower(),
        "name": payload.name,
        "password_hash": hash_password(payload.password),
        "role": payload.role,
        "permissions": perms,
        "active": payload.active,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    return _serialize(doc)


@api.patch("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdateIn, user: dict = Depends(require_permission("users", "edit"))):
    updates: Dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.role is not None:
        if payload.role not in ROLES:
            raise HTTPException(400, "Invalid role")
        updates["role"] = payload.role
    if payload.permissions is not None:
        updates["permissions"] = payload.permissions
    if payload.active is not None:
        updates["active"] = payload.active
    if payload.password:
        updates["password_hash"] = hash_password(payload.password)
    if not updates:
        raise HTTPException(400, "Nothing to update")
    res = await db.users.update_one({"id": user_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "User not found")
    u = await db.users.find_one({"id": user_id})
    return _serialize(u)


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_permission("users", "delete"))):
    if user_id == user["id"]:
        raise HTTPException(400, "You cannot delete your own account")
    res = await db.users.delete_one({"id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "User not found")
    return {"ok": True}


# =====================================================================
# Dynamic Catalog (categories/subcategories, attributes, lookups)
# =====================================================================
LOOKUP_COLLECTIONS = {
    "collections": "catalog",
    "tags": "catalog",
    "metal-types": "metal_types",
    "stone-types": "stone_types",
    "purities": "purities",
    "units": "units",
}
_LOOKUP_NAMES = {"collections", "tags", "metal_types", "stone_types", "purities", "units"}


def _clean(doc):
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


# ---------- Categories (with parent_id for subcategories) ----------
@api.get("/categories")
async def list_categories(
    parent_id: Optional[str] = None,
    include_tree: bool = False,
    user: dict = Depends(require_permission("catalog", "view")),
):
    """When include_tree=true returns nested categories with `children`."""
    docs = await db.categories.find({}).sort("display_order", 1).to_list(1000)
    for d in docs:
        d.pop("_id", None)
    if include_tree:
        by_parent: Dict[Optional[str], List[dict]] = {}
        for d in docs:
            by_parent.setdefault(d.get("parent_id"), []).append(d)
        def build(pid):
            return [{**c, "children": build(c["id"])} for c in by_parent.get(pid, [])]
        return build(None)
    if parent_id is not None:
        docs = [d for d in docs if d.get("parent_id") == parent_id]
    return docs


@api.post("/categories")
async def create_category(payload: CategoryIn, user: dict = Depends(require_permission("catalog", "create"))):
    if payload.parent_id:
        parent = await db.categories.find_one({"id": payload.parent_id})
        if not parent:
            raise HTTPException(400, "Parent category not found")
    doc = payload.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    await db.categories.insert_one(doc)
    return _clean(doc)


@api.patch("/categories/{cid}")
async def update_category(cid: str, payload: CategoryIn, user: dict = Depends(require_permission("catalog", "edit"))):
    res = await db.categories.update_one({"id": cid}, {"$set": payload.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return _clean(await db.categories.find_one({"id": cid}))


@api.delete("/categories/{cid}")
async def delete_category(cid: str, user: dict = Depends(require_permission("catalog", "delete"))):
    # Prevent deleting if used by products or has children
    if await db.categories.find_one({"parent_id": cid}):
        raise HTTPException(400, "Delete or reassign subcategories first")
    if await db.products.find_one({"$or": [{"category_id": cid}, {"subcategory_id": cid}]}):
        raise HTTPException(400, "Category is in use by products")
    res = await db.categories.delete_one({"id": cid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ---------- Attributes ----------
@api.get("/attributes")
async def list_attributes(
    category_id: Optional[str] = None,
    user: dict = Depends(require_permission("catalog", "view")),
):
    docs = await db.attributes.find({}).sort("display_order", 1).to_list(500)
    for d in docs:
        d.pop("_id", None)
    if category_id:
        # Include attributes with empty category_ids (global) OR contain this category
        docs = [d for d in docs if not d.get("category_ids") or category_id in d.get("category_ids", [])]
    return docs


@api.get("/attributes/for-product")
async def attributes_for_product(
    category_id: Optional[str] = None,
    subcategory_id: Optional[str] = None,
    user: dict = Depends(require_permission("inventory", "view")),
):
    docs = await db.attributes.find({}).sort("display_order", 1).to_list(500)
    for d in docs:
        d.pop("_id", None)
    ids = set(filter(None, [category_id, subcategory_id]))
    return [
        d for d in docs
        if not d.get("category_ids") or ids & set(d.get("category_ids", []))
    ]


@api.post("/attributes")
async def create_attribute(payload: AttributeIn, user: dict = Depends(require_permission("catalog", "create"))):
    doc = payload.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    await db.attributes.insert_one(doc)
    return _clean(doc)


@api.patch("/attributes/{aid}")
async def update_attribute(aid: str, payload: AttributeIn, user: dict = Depends(require_permission("catalog", "edit"))):
    res = await db.attributes.update_one({"id": aid}, {"$set": payload.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return _clean(await db.attributes.find_one({"id": aid}))


@api.delete("/attributes/{aid}")
async def delete_attribute(aid: str, user: dict = Depends(require_permission("catalog", "delete"))):
    res = await db.attributes.delete_one({"id": aid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ---------- Generic lookup endpoints ----------
def _resolve_lookup_collection(kind: str) -> str:
    m = {
        "collections": "collections",
        "tags": "tags",
        "metal-types": "metal_types",
        "stone-types": "stone_types",
        "purities": "purities",
        "units": "units",
    }
    if kind not in m:
        raise HTTPException(404, f"Unknown catalog resource: {kind}")
    return m[kind]


@api.get("/catalog/{kind}")
async def list_lookup(kind: str, user: dict = Depends(require_permission("catalog", "view"))):
    coll = _resolve_lookup_collection(kind)
    docs = await db[coll].find({}).sort("name", 1).to_list(500)
    return [_clean(d) for d in docs]


@api.post("/catalog/{kind}")
async def create_lookup(kind: str, payload: LookupIn, user: dict = Depends(require_permission("catalog", "create"))):
    coll = _resolve_lookup_collection(kind)
    doc = payload.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    if not doc.get("code"):
        doc["code"] = doc["name"].lower().replace(" ", "_")
    await db[coll].insert_one(doc)
    return _clean(doc)


@api.patch("/catalog/{kind}/{lid}")
async def update_lookup(kind: str, lid: str, payload: LookupIn, user: dict = Depends(require_permission("catalog", "edit"))):
    coll = _resolve_lookup_collection(kind)
    res = await db[coll].update_one({"id": lid}, {"$set": payload.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return _clean(await db[coll].find_one({"id": lid}))


@api.delete("/catalog/{kind}/{lid}")
async def delete_lookup(kind: str, lid: str, user: dict = Depends(require_permission("catalog", "delete"))):
    coll = _resolve_lookup_collection(kind)
    res = await db[coll].delete_one({"id": lid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# =====================================================================
# Products
# =====================================================================
async def _enrich_product(doc: dict) -> dict:
    """Attach category_name, subcategory_name, metal_name, purity_name for display."""
    if not doc:
        return doc
    async def _name(coll, _id):
        if not _id:
            return None
        d = await db[coll].find_one({"id": _id})
        return d.get("name") if d else None
    doc["category_name"] = await _name("categories", doc.get("category_id"))
    doc["subcategory_name"] = await _name("categories", doc.get("subcategory_id"))
    doc["metal_name"] = await _name("metal_types", doc.get("metal_type_id"))
    doc["purity_name"] = await _name("purities", doc.get("purity_id"))
    return doc


@api.get("/products")
async def list_products(
    q: Optional[str] = None,
    category_id: Optional[str] = None,
    subcategory_id: Optional[str] = None,
    metal_type_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    low_stock: Optional[bool] = None,
    user: dict = Depends(require_permission("inventory", "view")),
):
    filt: Dict[str, Any] = {}
    if q:
        filt["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"code": {"$regex": q, "$options": "i"}},
            {"barcode": {"$regex": q, "$options": "i"}},
        ]
    if category_id:
        filt["category_id"] = category_id
    if subcategory_id:
        filt["subcategory_id"] = subcategory_id
    if metal_type_id:
        filt["metal_type_id"] = metal_type_id
    if collection_id:
        filt["collection_ids"] = collection_id
    docs = await db.products.find(filt).sort("created_at", -1).to_list(1000)
    for d in docs:
        d.pop("_id", None)
    if low_stock:
        docs = [d for d in docs if d.get("stock_qty", 0) <= d.get("low_stock_threshold", 3)]
    return [await _enrich_product(d) for d in docs]


@api.get("/products/{pid}")
async def get_product(pid: str, user: dict = Depends(require_permission("inventory", "view"))):
    doc = await db.products.find_one({"id": pid})
    if not doc:
        raise HTTPException(404, "Not found")
    doc.pop("_id", None)
    return await _enrich_product(doc)


@api.post("/products")
async def create_product(payload: ProductIn, user: dict = Depends(require_permission("inventory", "create"))):
    doc = payload.model_dump()
    doc["id"] = new_id()
    if not doc.get("code"):
        doc["code"] = "AUR-" + doc["id"][:6].upper()
    if not doc.get("barcode"):
        doc["barcode"] = "890" + doc["id"].replace("-", "")[:10]
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.products.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich_product(doc)


@api.patch("/products/{pid}")
async def update_product(pid: str, payload: ProductIn, user: dict = Depends(require_permission("inventory", "edit"))):
    updates = payload.model_dump()
    updates["updated_at"] = now_iso()
    res = await db.products.update_one({"id": pid}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await db.products.find_one({"id": pid})
    doc.pop("_id", None)
    return await _enrich_product(doc)


@api.delete("/products/{pid}")
async def delete_product(pid: str, user: dict = Depends(require_permission("inventory", "delete"))):
    res = await db.products.delete_one({"id": pid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# =====================================================================
# Customers
# =====================================================================
@api.get("/customers")
async def list_customers(
    q: Optional[str] = None,
    tag: Optional[str] = None,
    user: dict = Depends(require_permission("customers", "view")),
):
    filt: Dict[str, Any] = {}
    if q:
        filt["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"mobile": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]
    if tag:
        filt["tag"] = tag
    docs = await db.customers.find(filt).sort("created_at", -1).to_list(1000)
    for d in docs:
        d.pop("_id", None)
    return docs


@api.get("/customers/{cid}")
async def get_customer(cid: str, user: dict = Depends(require_permission("customers", "view"))):
    doc = await db.customers.find_one({"id": cid})
    if not doc:
        raise HTTPException(404, "Not found")
    doc.pop("_id", None)
    invoices = await db.invoices.find({"customer_id": cid}).sort("created_at", -1).to_list(200)
    for i in invoices:
        i.pop("_id", None)
    schemes = await db.schemes.find({"customer_id": cid}).sort("created_at", -1).to_list(50)
    for s in schemes:
        s.pop("_id", None)
    return {"customer": doc, "invoices": invoices, "schemes": schemes}


@api.post("/customers")
async def create_customer(payload: CustomerIn, user: dict = Depends(require_permission("customers", "create"))):
    doc = payload.model_dump()
    doc["id"] = new_id()
    doc["total_purchases"] = 0.0
    doc["loyalty_points"] = 0
    doc["created_at"] = now_iso()
    await db.customers.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.patch("/customers/{cid}")
async def update_customer(cid: str, payload: CustomerIn, user: dict = Depends(require_permission("customers", "edit"))):
    updates = payload.model_dump()
    res = await db.customers.update_one({"id": cid}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await db.customers.find_one({"id": cid})
    doc.pop("_id", None)
    return doc


@api.delete("/customers/{cid}")
async def delete_customer(cid: str, user: dict = Depends(require_permission("customers", "delete"))):
    res = await db.customers.delete_one({"id": cid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# =====================================================================
# Invoices / POS
# =====================================================================
async def _next_invoice_no() -> str:
    settings = await db.settings.find_one({"key": "company"})
    prefix = (settings or {}).get("value", {}).get("invoice_prefix", "AUR")
    today = datetime.now(timezone.utc).strftime("%y%m%d")
    count = await db.invoices.count_documents({}) + 1
    return f"{prefix}-{today}-{count:04d}"


def _amount_in_words(amount: float) -> str:
    try:
        from num2words import num2words
        rupees = int(amount)
        paise = round((amount - rupees) * 100)
        text = num2words(rupees, lang="en_IN").title()
        if paise:
            text += f" and {num2words(paise, lang='en_IN').title()} Paise"
        return f"Indian Rupees {text} Only"
    except Exception:
        return f"Indian Rupees {int(amount)} Only"


def _render_invoice_pdf(invoice: dict, company: dict) -> bytes:
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as _canvas
    from reportlab.platypus import Table, TableStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    # Register a Unicode-capable font so ₹ renders correctly.
    _FONT = "Helvetica"
    _FONT_BOLD = "Helvetica-Bold"
    _FONT_ITALIC = "Helvetica-Oblique"
    _font_candidates = [
        (str(ROOT_DIR / "fonts" / "DejaVuSans.ttf"),
         str(ROOT_DIR / "fonts" / "DejaVuSans-Bold.ttf"),
         str(ROOT_DIR / "fonts" / "DejaVuSans.ttf")),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
         "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
         "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf"),
    ]
    for reg, bold, italic in _font_candidates:
        try:
            pdfmetrics.registerFont(TTFont("AurumSans", reg))
            pdfmetrics.registerFont(TTFont("AurumSans-Bold", bold))
            pdfmetrics.registerFont(TTFont("AurumSans-Italic", italic))
            _FONT = "AurumSans"
            _FONT_BOLD = "AurumSans-Bold"
            _FONT_ITALIC = "AurumSans-Italic"
            break
        except Exception:
            continue

    RUP = "\u20B9"  # ₹

    def indian_number(v, digits=2):
        value = float(v or 0)
        sign = "-" if value < 0 else ""
        fixed = f"{abs(value):.{digits}f}"
        whole, dot, fraction = fixed.partition(".")
        if len(whole) > 3:
            last_three = whole[-3:]
            leading = whole[:-3]
            pairs = []
            while leading:
                pairs.insert(0, leading[-2:])
                leading = leading[:-2]
            whole = ",".join(pairs + [last_three])
        return f"{sign}{whole}{dot}{fraction}" if digits else f"{sign}{whole}"

    def money(v):
        value = indian_number(v, 2)
        return f"{RUP}{value}" if _FONT != "Helvetica" else f"Rs.{value}"

    def money0(v):
        value = indian_number(v, 0)
        return f"{RUP}{value}" if _FONT != "Helvetica" else f"Rs.{value}"

    buf = BytesIO()
    c = _canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    margin = 15 * mm

    GOLD = colors.HexColor("#B49042")
    INK = colors.HexColor("#0A0A0A")
    MUTED = colors.HexColor("#737373")
    RULE = colors.HexColor("#E5E7EB")

    # ---------- Header ----------
    y = H - margin
    c.setFillColor(INK)
    c.setFont(_FONT_BOLD, 22)
    c.drawString(margin, y - 6, company.get("name") or "Aurum Jewellers")
    c.setFont(_FONT, 9)
    c.setFillColor(MUTED)
    c.drawString(margin, y - 22, company.get("tagline") or "")
    c.drawString(margin, y - 34, company.get("address") or "")
    c.drawString(margin, y - 46, f"Phone: {company.get('phone', '')}   ·   Email: {company.get('email', '')}")
    c.drawString(margin, y - 58, f"GSTIN: {company.get('gst_number', '')}")

    # Right side: TAX INVOICE badge
    c.setFillColor(GOLD)
    c.rect(W - margin - 60 * mm, y - 12, 60 * mm, 12, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont(_FONT_BOLD, 11)
    c.drawCentredString(W - margin - 30 * mm, y - 9, "TAX INVOICE")

    c.setFillColor(INK)
    c.setFont(_FONT_BOLD, 10)
    c.drawRightString(W - margin, y - 26, f"Invoice # {invoice.get('invoice_no', '')}")
    c.setFont(_FONT, 9)
    c.setFillColor(MUTED)
    dt = invoice.get("created_at", "")[:19].replace("T", " ")
    c.drawRightString(W - margin, y - 38, f"Date: {dt}")
    c.drawRightString(W - margin, y - 50, f"Status: {invoice.get('status', 'paid').upper()}")

    # Divider
    y -= 70
    c.setStrokeColor(RULE)
    c.line(margin, y, W - margin, y)
    y -= 10

    # ---------- Bill To ----------
    c.setFillColor(MUTED)
    c.setFont(_FONT_BOLD, 8)
    c.drawString(margin, y, "BILL TO")
    c.setFillColor(INK)
    c.setFont(_FONT_BOLD, 11)
    c.drawString(margin, y - 14, invoice.get("customer_name") or "Walk-in Customer")
    c.setFont(_FONT, 9)
    c.setFillColor(MUTED)
    if invoice.get("customer_mobile"):
        c.drawString(margin, y - 26, f"Mobile: {invoice.get('customer_mobile')}")

    # ---------- Items table ----------
    y -= 44
    header = [
        "S.No", "Description", "HSN", "Purity", "Net Wt (g)",
        "Making", "Qty", "Unit Price", "Amount",
    ]
    rows = [header]
    for i, it in enumerate(invoice.get("items", []), start=1):
        # Purity might include hallmark text — trim to first 8 chars for column fit
        purity = (it.get("purity") or "-")
        if len(purity) > 10:
            purity = purity.split(" ")[0]
        rows.append([
            str(i),
            (it.get("name") or "")[:32],
            it.get("hsn_code") or "7113",
            purity,
            f"{it.get('net_weight', 0):.2f}",
            money0(it.get('making_charges', 0)),
            str(it.get("quantity", 1)),
            money0(it.get('unit_price', 0)),
            money0(it.get('unit_price', 0) * it.get('quantity', 1)),
        ])

    col_widths = [12*mm, 44*mm, 14*mm, 16*mm, 18*mm, 20*mm, 10*mm, 22*mm, 24*mm]
    tbl = Table(rows, colWidths=col_widths, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F9FAFB")),
        ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
        ("FONT", (0, 0), (-1, 0), _FONT_BOLD, 8),
        ("FONT", (0, 1), (-1, -1), _FONT, 9),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (1, 0), (1, -1), "LEFT"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, RULE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.25, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    tbl_w, tbl_h = tbl.wrap(W - 2 * margin, 400)
    tbl.drawOn(c, margin, y - tbl_h)
    y -= tbl_h + 8

    # ---------- Totals block ----------
    subtotal = invoice.get("subtotal", 0)
    discount = invoice.get("discount", 0) or 0
    gst_pct = invoice.get("gst_pct", 3.0)
    gst_amount = invoice.get("gst_amount", 0)
    grand = invoice.get("grand_total", 0)

    cgst = gst_amount / 2
    sgst = gst_amount / 2

    totals_rows = [
        ["Subtotal", money(subtotal)],
        ["Discount", f"- {money(discount)}"],
        [f"CGST ({gst_pct/2:.1f}%)", money(cgst)],
        [f"SGST ({gst_pct/2:.1f}%)", money(sgst)],
        ["Grand Total", money(grand)],
    ]
    t2 = Table(totals_rows, colWidths=[45*mm, 40*mm])
    t2.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), _FONT, 10),
        ("FONT", (0, -1), (-1, -1), _FONT_BOLD, 11),
        ("TEXTCOLOR", (0, 0), (-1, -2), MUTED),
        ("TEXTCOLOR", (0, -1), (-1, -1), INK),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEABOVE", (0, -1), (-1, -1), 0.5, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    t2_w, t2_h = t2.wrap(85 * mm, 200)
    t2.drawOn(c, W - margin - t2_w, y - t2_h)
    y -= t2_h + 10

    # ---------- Amount in words ----------
    c.setFillColor(MUTED)
    c.setFont(_FONT_ITALIC, 9)
    c.drawString(margin, y, "Amount in words:")
    c.setFont(_FONT_BOLD, 9)
    c.setFillColor(INK)
    c.drawString(margin + 30 * mm, y, _amount_in_words(grand))
    y -= 14

    # ---------- Payments ----------
    c.setFillColor(MUTED)
    c.setFont(_FONT_BOLD, 8)
    c.drawString(margin, y, "PAYMENTS")
    y -= 4
    c.setStrokeColor(RULE)
    c.line(margin, y, W - margin, y)
    y -= 12
    c.setFont(_FONT, 9)
    c.setFillColor(INK)
    for p in invoice.get("payments", []):
        c.drawString(margin, y, f"{(p.get('mode') or '').replace('_', ' ').title()}")
        c.drawRightString(margin + 60 * mm, y, money(p.get('amount', 0)))
        y -= 12

    # ---------- Footer ----------
    y = 30 * mm
    c.setStrokeColor(RULE)
    c.line(margin, y + 10, W - margin, y + 10)
    c.setFont(_FONT, 8)
    c.setFillColor(MUTED)
    c.drawString(margin, y, "Terms: Goods once sold will not be taken back. Exchange within 15 days with original invoice.")
    c.drawString(margin, y - 10, "All prices are inclusive of hallmarking. Making charges are non-refundable.")
    c.drawRightString(W - margin, y - 10, "For " + (company.get("name") or "Aurum Jewellers"))
    c.drawRightString(W - margin, y - 28, "Authorised Signatory")

    # Gold band footer
    c.setFillColor(GOLD)
    c.rect(0, 0, W, 6 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont(_FONT, 7)
    c.drawCentredString(W / 2, 2 * mm, "Aurum ERP · Premium Jewellery Software")

    c.showPage()
    c.save()
    return buf.getvalue()


@api.post("/invoices")
async def create_invoice(payload: InvoiceIn, user: dict = Depends(require_permission("pos", "create"))):
    doc = payload.model_dump()
    doc["id"] = new_id()
    doc["invoice_no"] = await _next_invoice_no()
    doc["status"] = "paid"
    doc["created_at"] = now_iso()
    doc["created_by"] = user["id"]

    # validate stock before persisting
    for item in payload.items:
        prod = await db.products.find_one({"id": item.product_id})
        if not prod:
            raise HTTPException(400, f"Product not found: {item.name}")
        if (prod.get("stock_qty") or 0) < item.quantity:
            raise HTTPException(
                400,
                f"Insufficient stock for {prod.get('name')}: {prod.get('stock_qty', 0)} available",
            )

    await db.invoices.insert_one(doc)

    # decrement stock
    for item in payload.items:
        await db.products.update_one(
            {"id": item.product_id},
            {"$inc": {"stock_qty": -item.quantity}, "$set": {"updated_at": now_iso()}},
        )

    # update customer aggregates
    if payload.customer_id:
        await db.customers.update_one(
            {"id": payload.customer_id},
            {"$inc": {"total_purchases": payload.grand_total}},
        )

    doc.pop("_id", None)
    return doc


@api.get("/invoices")
async def list_invoices(
    q: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user: dict = Depends(require_permission("pos", "view")),
):
    filt: Dict[str, Any] = {}
    if q:
        filt["$or"] = [
            {"invoice_no": {"$regex": q, "$options": "i"}},
            {"customer_name": {"$regex": q, "$options": "i"}},
            {"customer_mobile": {"$regex": q, "$options": "i"}},
        ]
    if from_date:
        filt.setdefault("created_at", {})["$gte"] = from_date
    if to_date:
        filt.setdefault("created_at", {})["$lte"] = to_date + "T23:59:59Z"
    docs = await db.invoices.find(filt).sort("created_at", -1).to_list(500)
    for d in docs:
        d.pop("_id", None)
    return docs


@api.get("/invoices/{iid}")
async def get_invoice(iid: str, user: dict = Depends(require_permission("pos", "view"))):
    doc = await db.invoices.find_one({"id": iid})
    if not doc:
        raise HTTPException(404, "Not found")
    doc.pop("_id", None)
    return doc


@api.get("/invoices/{iid}/pdf")
async def invoice_pdf(iid: str, user: dict = Depends(require_permission("pos", "view"))):
    from fastapi.responses import StreamingResponse
    invoice = await db.invoices.find_one({"id": iid})
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    company_doc = await db.settings.find_one({"key": "company"}) or {}
    company = company_doc.get("value", {})
    pdf_bytes = _render_invoice_pdf(invoice, company)
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{invoice.get("invoice_no")}.pdf"'},
    )


# =====================================================================
# Gold Schemes
# =====================================================================
@api.get("/schemes")
async def list_schemes(user: dict = Depends(require_permission("gold_schemes", "view"))):
    docs = await db.schemes.find({}).sort("created_at", -1).to_list(500)
    for d in docs:
        d.pop("_id", None)
    # augment with due status
    today = datetime.now(timezone.utc).date()
    for d in docs:
        paid_count = len(d.get("payments", []))
        duration = d.get("duration_months", 12)
        d["paid_installments"] = paid_count
        d["remaining_installments"] = max(0, duration - paid_count)
        d["total_paid"] = sum(p.get("amount", 0) for p in d.get("payments", []))
        d["is_matured"] = paid_count >= duration
    return docs


@api.post("/schemes")
async def create_scheme(payload: SchemeIn, user: dict = Depends(require_permission("gold_schemes", "create"))):
    doc = payload.model_dump()
    doc["id"] = new_id()
    doc["payments"] = []
    doc["status"] = "active"
    doc["created_at"] = now_iso()
    await db.schemes.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.post("/schemes/{sid}/payments")
async def add_scheme_payment(sid: str, payload: SchemePaymentIn, user: dict = Depends(require_permission("gold_schemes", "edit"))):
    scheme = await db.schemes.find_one({"id": sid})
    if not scheme:
        raise HTTPException(404, "Scheme not found")
    payment = payload.model_dump()
    payment["id"] = new_id()
    payment["paid_at"] = now_iso()
    payment["installment_no"] = len(scheme.get("payments", [])) + 1
    await db.schemes.update_one(
        {"id": sid},
        {"$push": {"payments": payment}},
    )
    updated = await db.schemes.find_one({"id": sid})
    updated.pop("_id", None)
    return updated


@api.get("/schemes/{sid}")
async def get_scheme(sid: str, user: dict = Depends(require_permission("gold_schemes", "view"))):
    doc = await db.schemes.find_one({"id": sid})
    if not doc:
        raise HTTPException(404, "Not found")
    doc.pop("_id", None)
    return doc


# =====================================================================
# Dashboard & Reports
# =====================================================================
@api.get("/dashboard/summary")
async def dashboard_summary(user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    invoices_today = await db.invoices.find({"created_at": {"$gte": today_start}}).to_list(1000)
    invoices_month = await db.invoices.find({"created_at": {"$gte": month_start}}).to_list(5000)

    today_sales = sum(i.get("grand_total", 0) for i in invoices_today)
    month_sales = sum(i.get("grand_total", 0) for i in invoices_month)

    total_customers = await db.customers.count_documents({})
    products = await db.products.find({}).to_list(2000)
    stock_value = sum((p.get("selling_price", 0) or 0) * (p.get("stock_qty", 0) or 0) for p in products)
    low_stock = [p for p in products if p.get("stock_qty", 0) <= p.get("low_stock_threshold", 3)]
    for p in low_stock:
        p.pop("_id", None)

    schemes = await db.schemes.find({}).to_list(1000)
    schemes_due = 0
    for s in schemes:
        paid_count = len(s.get("payments", []))
        # naive: if paid_count < months elapsed since start_date -> due
        try:
            start = datetime.fromisoformat(s.get("start_date"))
            months_elapsed = (now.year - start.year) * 12 + (now.month - start.month)
            if paid_count < min(months_elapsed, s.get("duration_months", 12)):
                schemes_due += 1
        except Exception:
            pass

    # gold rate
    rate_doc = await db.settings.find_one({"key": "gold_rate"})
    gold_rate = (rate_doc or {}).get("value", {})

    # recent invoices
    recent = await db.invoices.find({}).sort("created_at", -1).to_list(6)
    for r in recent:
        r.pop("_id", None)

    # sales trend last 7 days
    trend = []
    for i in range(6, -1, -1):
        day = (now - timedelta(days=i))
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day.replace(hour=23, minute=59, second=59)
        invs = await db.invoices.find(
            {"created_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}}
        ).to_list(2000)
        trend.append(
            {
                "date": day.strftime("%d %b"),
                "sales": round(sum(x.get("grand_total", 0) for x in invs), 2),
                "orders": len(invs),
            }
        )

    # category performance
    category_perf: Dict[str, float] = {}
    for inv in invoices_month:
        for item in inv.get("items", []):
            metal = item.get("metal", "other").capitalize()
            category_perf[metal] = category_perf.get(metal, 0) + (item.get("unit_price", 0) * item.get("quantity", 1))
    category_data = [{"name": k, "value": round(v, 2)} for k, v in category_perf.items()]

    return {
        "kpis": {
            "today_sales": round(today_sales, 2),
            "month_sales": round(month_sales, 2),
            "today_orders": len(invoices_today),
            "month_orders": len(invoices_month),
            "total_customers": total_customers,
            "stock_value": round(stock_value, 2),
            "low_stock_count": len(low_stock),
            "schemes_active": len(schemes),
            "schemes_due": schemes_due,
        },
        "gold_rate": gold_rate,
        "low_stock": low_stock[:6],
        "recent_invoices": recent,
        "trend": trend,
        "category_performance": category_data,
    }


@api.get("/reports/sales")
async def reports_sales(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user: dict = Depends(require_permission("reports", "view")),
):
    filt: Dict[str, Any] = {}
    if from_date:
        filt.setdefault("created_at", {})["$gte"] = from_date
    if to_date:
        filt.setdefault("created_at", {})["$lte"] = to_date + "T23:59:59Z"
    docs = await db.invoices.find(filt).sort("created_at", -1).to_list(5000)
    for d in docs:
        d.pop("_id", None)
    total = sum(i.get("grand_total", 0) for i in docs)
    gst = sum(i.get("gst_amount", 0) for i in docs)
    return {
        "invoices": docs,
        "totals": {"count": len(docs), "grand_total": round(total, 2), "gst_collected": round(gst, 2)},
    }


# =====================================================================
# Settings
# =====================================================================
@api.get("/settings/company")
async def get_company(user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"key": "company"})
    return (doc or {}).get("value", {})


@api.put("/settings/company")
async def update_company(payload: Dict[str, Any], user: dict = Depends(require_permission("settings", "edit"))):
    await db.settings.update_one({"key": "company"}, {"$set": {"value": payload}}, upsert=True)
    return payload


@api.get("/settings/gold-rate")
async def get_gold_rate(user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"key": "gold_rate"})
    return (doc or {}).get("value", {})


@api.put("/settings/gold-rate")
async def update_gold_rate(payload: GoldRateIn, user: dict = Depends(require_permission("settings", "edit"))):
    val = payload.model_dump()
    val["updated_at"] = now_iso()
    await db.settings.update_one({"key": "gold_rate"}, {"$set": {"value": val}}, upsert=True)
    return val


# =====================================================================
# Register + CORS
# =====================================================================
@api.get("/")
async def api_root():
    return {"app": "Aurum ERP", "status": "ok"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
