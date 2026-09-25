"""Phase 2a: Catalog, dynamic attributes, GST PDF, RBAC."""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "https://aurum-erp.preview.emergentagent.com"
API = f"{BASE_URL}/api"

OWNER_EMAIL = "owner@aurum.jewellery"
OWNER_PASS = "Aurum@2026"


@pytest.fixture(scope="module")
def owner_headers():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def top_categories(owner_headers):
    r = requests.get(f"{API}/categories?include_tree=true", headers=owner_headers)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Categories ----------
class TestCategories:
    def test_tree_seeded(self, top_categories):
        assert isinstance(top_categories, list)
        names = [c["name"] for c in top_categories]
        for expected in ["Rings", "Necklaces", "Earrings", "Bangles", "Chains", "Anklets", "Pendants"]:
            assert expected in names, f"{expected} missing. Got: {names}"
        # Ensure children key exists on top level
        rings = next(c for c in top_categories if c["name"] == "Rings")
        assert "children" in rings

    def test_create_top_and_sub_delete(self, owner_headers):
        # Create top
        r = requests.post(f"{API}/categories", json={"name": "TEST_TopCat"}, headers=owner_headers)
        assert r.status_code == 200, r.text
        top_id = r.json()["id"]

        # Create sub
        r = requests.post(f"{API}/categories", json={"name": "TEST_SubCat", "parent_id": top_id}, headers=owner_headers)
        assert r.status_code == 200
        sub_id = r.json()["id"]
        assert r.json()["parent_id"] == top_id

        # Deleting parent while child exists should fail
        r = requests.delete(f"{API}/categories/{top_id}", headers=owner_headers)
        assert r.status_code == 400, f"Expected 400 when deleting parent with children, got {r.status_code}"

        # Delete sub first
        assert requests.delete(f"{API}/categories/{sub_id}", headers=owner_headers).status_code == 200
        # Now delete top
        assert requests.delete(f"{API}/categories/{top_id}", headers=owner_headers).status_code == 200

    def test_cannot_delete_referenced_category(self, owner_headers, top_categories):
        rings = next(c for c in top_categories if c["name"] == "Rings")
        r = requests.delete(f"{API}/categories/{rings['id']}", headers=owner_headers)
        # Rings has both children AND products — should fail
        assert r.status_code == 400


# ---------- Attributes ----------
class TestAttributes:
    def test_for_product_rings(self, owner_headers, top_categories):
        rings = next(c for c in top_categories if c["name"] == "Rings")
        r = requests.get(f"{API}/attributes/for-product?category_id={rings['id']}", headers=owner_headers)
        assert r.status_code == 200, r.text
        names = [a["name"] for a in r.json()]
        for expected in ["Ring Size", "Gender", "Occasion", "Certified", "Certification Number"]:
            assert expected in names, f"{expected} missing. Got: {names}"

    def test_create_dropdown_attr_and_delete(self, owner_headers, top_categories):
        rings = next(c for c in top_categories if c["name"] == "Rings")
        payload = {
            "name": "TEST_Style",
            "code": "test_style",
            "field_type": "dropdown",
            "options": ["Classic", "Modern", "Vintage"],
            "required": False,
            "category_ids": [rings["id"]],
        }
        r = requests.post(f"{API}/attributes", json=payload, headers=owner_headers)
        assert r.status_code == 200, r.text
        aid = r.json()["id"]

        r = requests.get(f"{API}/attributes/for-product?category_id={rings['id']}", headers=owner_headers)
        assert any(a["id"] == aid for a in r.json())

        assert requests.delete(f"{API}/attributes/{aid}", headers=owner_headers).status_code == 200


# ---------- Lookups ----------
class TestLookups:
    def test_metal_types_seeded(self, owner_headers):
        r = requests.get(f"{API}/catalog/metal-types", headers=owner_headers)
        assert r.status_code == 200
        names = [x["name"] for x in r.json()]
        for m in ["Gold", "Silver", "Platinum", "Diamond"]:
            assert m in names
        assert len(r.json()) == 4

    def test_tags_crud(self, owner_headers):
        r = requests.post(f"{API}/catalog/tags", json={"name": "TEST_Tag", "color": "#ff0000"}, headers=owner_headers)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]

        r = requests.patch(f"{API}/catalog/tags/{tid}", json={"name": "TEST_Tag2", "color": "#00ff00"}, headers=owner_headers)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Tag2"

        assert requests.delete(f"{API}/catalog/tags/{tid}", headers=owner_headers).status_code == 200


# ---------- Products (dynamic) ----------
class TestProductsDynamic:
    def test_list_enriched(self, owner_headers):
        r = requests.get(f"{API}/products", headers=owner_headers)
        assert r.status_code == 200
        prods = r.json()
        assert len(prods) >= 1
        p = prods[0]
        # Enrichment fields
        for k in ["category_name", "metal_name", "purity_name"]:
            assert k in p, f"missing {k}. Keys: {list(p.keys())}"

    def test_filter_by_category_and_metal(self, owner_headers, top_categories):
        rings = next(c for c in top_categories if c["name"] == "Rings")
        r = requests.get(f"{API}/products?category_id={rings['id']}", headers=owner_headers)
        assert r.status_code == 200
        for p in r.json():
            assert p.get("category_id") == rings["id"]

        metals = requests.get(f"{API}/catalog/metal-types", headers=owner_headers).json()
        gold = next(m for m in metals if m["name"] == "Gold")
        r = requests.get(f"{API}/products?metal_type_id={gold['id']}", headers=owner_headers)
        assert r.status_code == 200
        for p in r.json():
            assert p.get("metal_type_id") == gold["id"]

    def test_create_product_with_attrs(self, owner_headers, top_categories):
        rings = next(c for c in top_categories if c["name"] == "Rings")
        metals = requests.get(f"{API}/catalog/metal-types", headers=owner_headers).json()
        gold = next(m for m in metals if m["name"] == "Gold")
        purities = requests.get(f"{API}/catalog/purities", headers=owner_headers).json()
        p22 = next(p for p in purities if "22" in p["name"])
        stones = requests.get(f"{API}/catalog/stone-types", headers=owner_headers).json()
        stone_ids = [stones[0]["id"]] if stones else []

        payload = {
            "name": "TEST_DynRing",
            "category_id": rings["id"],
            "metal_type_id": gold["id"],
            "purity_id": p22["id"],
            "stone_type_ids": stone_ids,
            "attribute_values": {"ring_size": "16", "gender": "Female"},
            "gross_weight": 6.0,
            "net_weight": 5.5,
            "selling_price": 55000,
            "stock_qty": 3,
            "hsn_code": "7113",
            "gst_slab": 3.0,
        }
        r = requests.post(f"{API}/products", json=payload, headers=owner_headers)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]

        # Fetch and check persistence + enrichment
        r = requests.get(f"{API}/products/{pid}", headers=owner_headers)
        assert r.status_code == 200
        prod = r.json()
        assert prod["category_id"] == rings["id"]
        assert prod["metal_type_id"] == gold["id"]
        assert prod.get("attribute_values", {}).get("ring_size") == "16"
        if stone_ids:
            assert stone_ids[0] in prod.get("stone_type_ids", [])

        requests.delete(f"{API}/products/{pid}", headers=owner_headers)


# ---------- Invoice PDF ----------
class TestInvoicePdf:
    def test_pdf_generation(self, owner_headers):
        prods = requests.get(f"{API}/products", headers=owner_headers).json()
        prod = next(p for p in prods if p["stock_qty"] > 0)
        unit_price = float(prod["selling_price"])
        payload = {
            "customer_name": "TEST_PDF_Customer",
            "items": [{
                "product_id": prod["id"],
                "name": prod["name"],
                "metal": prod.get("metal") or prod.get("metal_name", "gold").lower(),
                "purity": prod.get("purity") or prod.get("purity_name", "22K"),
                "quantity": 1,
                "unit_price": unit_price,
                "hsn_code": "7113",
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
        inv_id = r.json()["id"]

        r = requests.get(f"{API}/invoices/{inv_id}/pdf", headers=owner_headers)
        assert r.status_code == 200, r.text[:200]
        assert "application/pdf" in r.headers.get("Content-Type", "")
        assert r.content[:8].startswith(b"%PDF-1."), f"Not a PDF: {r.content[:20]}"
        assert len(r.content) > 3000, f"PDF too small: {len(r.content)} bytes"


# ---------- RBAC Catalog ----------
class TestCatalogRbac:
    def test_cashier_no_catalog(self, owner_headers):
        email = "test_cashier_p2a@aurum.jewellery"
        users = requests.get(f"{API}/users", headers=owner_headers).json()
        for u in users:
            if u["email"] == email:
                requests.delete(f"{API}/users/{u['id']}", headers=owner_headers)

        r = requests.post(f"{API}/users", json={
            "email": email, "name": "Cashier P2A", "password": "Cashier@2026", "role": "cashier"
        }, headers=owner_headers)
        assert r.status_code == 200, r.text
        uid = r.json()["id"]

        try:
            r = requests.post(f"{API}/auth/login", json={"email": email, "password": "Cashier@2026"})
            token = r.json()["access_token"]
            h = {"Authorization": f"Bearer {token}"}

            assert requests.get(f"{API}/categories", headers=h).status_code == 403
            assert requests.get(f"{API}/attributes", headers=h).status_code == 403
            assert requests.get(f"{API}/products", headers=h).status_code == 200
        finally:
            requests.delete(f"{API}/users/{uid}", headers=owner_headers)
