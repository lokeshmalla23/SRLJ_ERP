"""Aurum ERP backend API tests."""
import os
import pytest
import requests
from datetime import date

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "https://aurum-erp.preview.emergentagent.com"
API = f"{BASE_URL}/api"

OWNER_EMAIL = "owner@aurum.jewellery"
OWNER_PASS = "Aurum@2026"


@pytest.fixture(scope="session")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    assert data["user"]["role"] == "shop_owner"
    return data["access_token"]


@pytest.fixture(scope="session")
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


# ---------------- Auth ----------------
class TestAuth:
    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_login_success_returns_token(self, owner_token):
        assert isinstance(owner_token, str) and len(owner_token) > 10

    def test_me(self, owner_headers):
        r = requests.get(f"{API}/auth/me", headers=owner_headers)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == OWNER_EMAIL
        assert d["role"] == "shop_owner"
        assert "password_hash" not in d

    def test_me_no_token(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401


# ---------------- Products / Inventory ----------------
class TestProducts:
    def test_list_seeded(self, owner_headers):
        r = requests.get(f"{API}/products", headers=owner_headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 8

    def test_search_filter(self, owner_headers):
        r = requests.get(f"{API}/products?q=diamond", headers=owner_headers)
        assert r.status_code == 200
        data = r.json()
        assert all("diamond" in (p["name"].lower() + p.get("code","").lower()) for p in data)

    def test_metal_filter(self, owner_headers):
        r = requests.get(f"{API}/products?metal=silver", headers=owner_headers)
        assert r.status_code == 200
        assert all(p["metal"] == "silver" for p in r.json())

    def test_low_stock_filter(self, owner_headers):
        r = requests.get(f"{API}/products?low_stock=true", headers=owner_headers)
        assert r.status_code == 200
        for p in r.json():
            assert p["stock_qty"] <= p.get("low_stock_threshold", 3)

    def test_crud_product(self, owner_headers):
        payload = {
            "name": "TEST_Gold Ring",
            "category": "Ring",
            "metal": "gold",
            "purity": "22K",
            "gross_weight": 5.0,
            "net_weight": 5.0,
            "making_charges": 1500,
            "selling_price": 40000,
            "stock_qty": 10,
        }
        r = requests.post(f"{API}/products", json=payload, headers=owner_headers)
        assert r.status_code == 200, r.text
        prod = r.json()
        pid = prod["id"]
        assert prod["code"].startswith("AUR-")

        # GET
        r = requests.get(f"{API}/products/{pid}", headers=owner_headers)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Gold Ring"

        # PATCH price
        payload["selling_price"] = 42000
        r = requests.patch(f"{API}/products/{pid}", json=payload, headers=owner_headers)
        assert r.status_code == 200
        assert r.json()["selling_price"] == 42000

        # DELETE
        r = requests.delete(f"{API}/products/{pid}", headers=owner_headers)
        assert r.status_code == 200
        assert requests.get(f"{API}/products/{pid}", headers=owner_headers).status_code == 404


# ---------------- Customers ----------------
class TestCustomers:
    def test_list_seeded(self, owner_headers):
        r = requests.get(f"{API}/customers", headers=owner_headers)
        assert r.status_code == 200
        assert len(r.json()) >= 5

    def test_search_by_name(self, owner_headers):
        r = requests.get(f"{API}/customers?q=Aditi", headers=owner_headers)
        assert r.status_code == 200
        assert any("Aditi" in c["name"] for c in r.json())

    def test_create_and_detail(self, owner_headers):
        r = requests.post(f"{API}/customers", json={
            "name": "TEST_Customer A", "mobile": "9999900001", "tag": "regular"
        }, headers=owner_headers)
        assert r.status_code == 200
        cid = r.json()["id"]

        r = requests.get(f"{API}/customers/{cid}", headers=owner_headers)
        assert r.status_code == 200
        d = r.json()
        assert "customer" in d and "invoices" in d and "schemes" in d
        assert d["customer"]["name"] == "TEST_Customer A"

        requests.delete(f"{API}/customers/{cid}", headers=owner_headers)


# ---------------- Dashboard ----------------
class TestDashboard:
    def test_summary(self, owner_headers):
        r = requests.get(f"{API}/dashboard/summary", headers=owner_headers)
        assert r.status_code == 200
        d = r.json()
        for k in ["kpis", "gold_rate", "low_stock", "recent_invoices", "trend"]:
            assert k in d
        assert "today_sales" in d["kpis"]
        assert "gold_22k" in d["gold_rate"]
        assert len(d["trend"]) == 7


# ---------------- POS / Invoice ----------------
class TestInvoice:
    def test_create_invoice_and_stock_decrement(self, owner_headers):
        prods = requests.get(f"{API}/products", headers=owner_headers).json()
        prod = next(p for p in prods if p["stock_qty"] > 0)
        pid = prod["id"]
        before_stock = prod["stock_qty"]
        unit_price = float(prod["selling_price"])

        payload = {
            "customer_name": "Walk-in",
            "items": [{
                "product_id": pid,
                "name": prod["name"],
                "metal": prod["metal"],
                "purity": prod["purity"],
                "quantity": 1,
                "unit_price": unit_price,
            }],
            "subtotal": unit_price,
            "discount": 0,
            "gst_pct": 3.0,
            "gst_amount": round(unit_price * 0.03, 2),
            "grand_total": round(unit_price * 1.03, 2),
            "payments": [{"mode": "cash", "amount": round(unit_price * 1.03, 2)}],
        }
        r = requests.post(f"{API}/invoices", json=payload, headers=owner_headers)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["invoice_no"].startswith("AUR-")

        r = requests.get(f"{API}/products/{pid}", headers=owner_headers)
        assert r.json()["stock_qty"] == before_stock - 1

    def test_list_invoices(self, owner_headers):
        r = requests.get(f"{API}/invoices", headers=owner_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------------- Schemes ----------------
class TestSchemes:
    def test_create_scheme_and_payment(self, owner_headers):
        customers = requests.get(f"{API}/customers", headers=owner_headers).json()
        c = customers[0]
        r = requests.post(f"{API}/schemes", json={
            "customer_id": c["id"],
            "customer_name": c["name"],
            "plan_name": "TEST_11+1",
            "monthly_amount": 5000,
            "duration_months": 12,
            "start_date": date.today().isoformat(),
        }, headers=owner_headers)
        assert r.status_code == 200
        sid = r.json()["id"]

        r = requests.post(f"{API}/schemes/{sid}/payments", json={"amount": 5000, "mode": "cash"}, headers=owner_headers)
        assert r.status_code == 200
        assert len(r.json()["payments"]) == 1

        r = requests.get(f"{API}/schemes", headers=owner_headers)
        s = next(x for x in r.json() if x["id"] == sid)
        assert s["paid_installments"] == 1


# ---------------- Reports ----------------
class TestReports:
    def test_sales(self, owner_headers):
        r = requests.get(f"{API}/reports/sales", headers=owner_headers)
        assert r.status_code == 200
        d = r.json()
        assert "invoices" in d and "totals" in d


# ---------------- Settings ----------------
class TestSettings:
    def test_get_company(self, owner_headers):
        r = requests.get(f"{API}/settings/company", headers=owner_headers)
        assert r.status_code == 200
        assert "name" in r.json()

    def test_update_company(self, owner_headers):
        cur = requests.get(f"{API}/settings/company", headers=owner_headers).json()
        cur["name"] = "TEST_Aurum Jewellers"
        r = requests.put(f"{API}/settings/company", json=cur, headers=owner_headers)
        assert r.status_code == 200
        assert requests.get(f"{API}/settings/company", headers=owner_headers).json()["name"] == "TEST_Aurum Jewellers"
        # restore
        cur["name"] = "Aurum Jewellers"
        requests.put(f"{API}/settings/company", json=cur, headers=owner_headers)

    def test_update_gold_rate(self, owner_headers):
        r = requests.put(f"{API}/settings/gold-rate", json={
            "gold_22k": 6600.0, "gold_18k": 5400.0, "gold_24k": 7200.0, "silver": 93.0
        }, headers=owner_headers)
        assert r.status_code == 200
        assert r.json()["gold_22k"] == 6600.0


# ---------------- RBAC ----------------
class TestRBAC:
    def test_create_cashier_and_permissions(self, owner_headers):
        email = "test_cashier@aurum.jewellery"
        # cleanup if exists
        users = requests.get(f"{API}/users", headers=owner_headers).json()
        for u in users:
            if u["email"] == email:
                requests.delete(f"{API}/users/{u['id']}", headers=owner_headers)

        r = requests.post(f"{API}/users", json={
            "email": email, "name": "TEST Cashier", "password": "Cashier@2026", "role": "cashier"
        }, headers=owner_headers)
        assert r.status_code == 200, r.text
        uid = r.json()["id"]

        # login as cashier
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "Cashier@2026"})
        assert r.status_code == 200
        token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        # cashier cannot list schemes
        assert requests.get(f"{API}/schemes", headers=h).status_code == 403
        # cashier cannot access reports
        assert requests.get(f"{API}/reports/sales", headers=h).status_code == 403
        # cashier CAN view products
        assert requests.get(f"{API}/products", headers=h).status_code == 200
        # cashier cannot create product
        assert requests.post(f"{API}/products", json={"name":"X","category":"Ring","metal":"gold","purity":"22K"}, headers=h).status_code == 403

        # cleanup
        requests.delete(f"{API}/users/{uid}", headers=owner_headers)
