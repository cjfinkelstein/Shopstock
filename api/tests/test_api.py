"""API-level tests: auth flows, cost stripping, job costing, batches, reports."""

from decimal import Decimal


def login_admin(client):
    r = client.post("/api/v1/auth/login", json={"email": "admin@test.local", "password": "pw"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def login_tech(client, seeded):
    r = client.post("/api/v1/auth/tap", json={"user_id": seeded["tech"].id})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def receive(client, hdrs, seeded, item, qty, cost):
    r = client.post("/api/v1/transactions/receive", headers=hdrs, json={
        "item_id": seeded[item].id, "qty": str(qty), "vendor_id": seeded["vendor"].id,
        "unit_cost": str(cost)})
    assert r.status_code == 201, r.text
    return r.json()


COST_KEYS = {"avg_cost", "last_cost", "unit_cost", "cost", "value", "net_cost",
             "total_cost", "cost_impact", "avg_snapshot_cost"}


def assert_no_cost_keys(payload, path="$"):
    if isinstance(payload, dict):
        for k, v in payload.items():
            assert k not in COST_KEYS, f"cost field {k!r} leaked at {path}"
            assert_no_cost_keys(v, f"{path}.{k}")
    elif isinstance(payload, list):
        for i, v in enumerate(payload):
            assert_no_cost_keys(v, f"{path}[{i}]")


class TestAuth:
    def test_tap_flow(self, client, seeded):
        r = client.get("/api/v1/users/techs")  # unauthenticated
        assert r.status_code == 200
        assert [t["name"] for t in r.json()] == ["Mike"]
        hdrs = login_tech(client, seeded)
        me = client.get("/api/v1/auth/me", headers=hdrs).json()
        assert me["name"] == "Mike" and me["role"] == "tech"

    def test_pin_enforced_when_set(self, client, seeded, db_session):
        from app.auth import hash_secret
        seeded["tech"].pin_hash = hash_secret("1234")
        db_session.commit()
        r = client.post("/api/v1/auth/tap", json={"user_id": seeded["tech"].id})
        assert r.status_code == 401
        r = client.post("/api/v1/auth/tap", json={"user_id": seeded["tech"].id, "pin": "9999"})
        assert r.status_code == 401
        r = client.post("/api/v1/auth/tap", json={"user_id": seeded["tech"].id, "pin": "1234"})
        assert r.status_code == 200

    def test_admin_cannot_tap(self, client, seeded):
        r = client.post("/api/v1/auth/tap", json={"user_id": seeded["admin"].id})
        assert r.status_code == 401

    def test_bad_password(self, client, seeded):
        r = client.post("/api/v1/auth/login", json={"email": "admin@test.local", "password": "nope"})
        assert r.status_code == 401


class TestCostStripping:
    """Costs must be stripped from tech responses SERVER-SIDE — raw JSON checked here."""

    def test_tech_sees_no_costs_anywhere(self, client, seeded):
        admin = login_admin(client)
        tech = login_tech(client, seeded)
        receive(client, admin, seeded, "romex", "1000", "0.85")
        client.post("/api/v1/transactions/sign-out", headers=tech, json={
            "item_id": seeded["romex"].id, "qty": "50",
            "from_location_id": seeded["shop"].id, "job_id": seeded["job"].id})

        for url in (f"/api/v1/items",
                    f"/api/v1/items/{seeded['romex'].id}",
                    f"/api/v1/items/by-barcode/WIRE-122NM",
                    f"/api/v1/items/{seeded['romex'].id}/stock",
                    f"/api/v1/items/{seeded['romex'].id}/history",
                    "/api/v1/transactions?mine=true",
                    "/api/v1/stock",
                    "/api/v1/dashboard/tech"):
            r = client.get(url, headers=tech)
            assert r.status_code == 200, f"{url}: {r.text}"
            assert_no_cost_keys(r.json(), url)

    def test_admin_sees_costs(self, client, seeded):
        admin = login_admin(client)
        receive(client, admin, seeded, "romex", "1000", "0.85")
        item = client.get(f"/api/v1/items/{seeded['romex'].id}", headers=admin).json()
        assert Decimal(str(item["avg_cost"])) == Decimal("0.85")

    def test_tech_blocked_from_admin_endpoints(self, client, seeded):
        tech = login_tech(client, seeded)
        for method, url in (("GET", "/api/v1/stock/valuation"),
                            ("GET", "/api/v1/reports/reorder"),
                            ("GET", "/api/v1/dashboard/admin"),
                            ("GET", f"/api/v1/jobs/{seeded['job'].id}/materials"),
                            ("GET", "/api/v1/vendors"),
                            ("POST", "/api/v1/transactions/adjust"),
                            ("POST", "/api/v1/transactions/receive")):
            r = client.request(method, url, headers=tech, json={})
            assert r.status_code == 403, f"{url} returned {r.status_code}"


class TestJobCosting:
    def test_materials_view_math(self, client, seeded):
        admin = login_admin(client)
        tech = login_tech(client, seeded)
        receive(client, admin, seeded, "romex", "1000", "0.85")
        client.post("/api/v1/transactions/sign-out", headers=tech, json={
            "item_id": seeded["romex"].id, "qty": "50",
            "from_location_id": seeded["shop"].id, "job_id": seeded["job"].id})
        client.post("/api/v1/transactions/return", headers=tech, json={
            "item_id": seeded["romex"].id, "qty": "20",
            "to_location_id": seeded["shop"].id, "job_id": seeded["job"].id})
        r = client.get(f"/api/v1/jobs/{seeded['job'].id}/materials", headers=admin)
        data = r.json()
        line = data["lines"][0]
        assert Decimal(str(line["net_qty"])) == Decimal("30")
        # 50*0.85 - 20*0.85 = 25.50
        assert Decimal(str(data["total_cost"])) == Decimal("25.50")

    def test_materials_csv(self, client, seeded):
        admin = login_admin(client)
        receive(client, admin, seeded, "romex", "100", "0.85")
        r = client.get(f"/api/v1/jobs/{seeded['job'].id}/materials?format=csv", headers=admin)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")


class TestBatchAndReports:
    def test_batch_sign_out_atomic(self, client, seeded):
        admin = login_admin(client)
        tech = login_tech(client, seeded)
        receive(client, admin, seeded, "romex", "100", "0.85")
        receive(client, admin, seeded, "box", "20", "1.95")
        r = client.post("/api/v1/transactions/sign-out/batch", headers=tech, json={
            "job_id": seeded["job"].id, "from_location_id": seeded["shop"].id,
            "lines": [{"item_id": seeded["romex"].id, "qty": "25"},
                      {"item_id": seeded["box"].id, "qty": "4"}]})
        assert r.status_code == 201
        assert len(r.json()) == 2

    def test_batch_transfer(self, client, seeded):
        admin = login_admin(client)
        tech = login_tech(client, seeded)
        receive(client, admin, seeded, "romex", "100", "0.85")
        r = client.post("/api/v1/transactions/transfer/batch", headers=tech, json={
            "from_location_id": seeded["shop"].id, "to_location_id": seeded["truck_loc"].id,
            "lines": [{"item_id": seeded["romex"].id, "qty": "40"}]})
        assert r.status_code == 201
        stock = client.get(f"/api/v1/stock?location_id={seeded['truck_loc'].id}",
                           headers=tech).json()
        assert Decimal(str(stock[0]["qty"])) == Decimal("40")

    def test_reorder_report_and_csv(self, client, seeded):
        admin = login_admin(client)
        receive(client, admin, seeded, "romex", "80", "0.85")  # below reorder point 100
        r = client.get("/api/v1/reports/reorder", headers=admin)
        skus = [i["sku"] for c in r.json()["categories"] for i in c["items"]]
        assert "WIRE-122NM" in skus
        r = client.get("/api/v1/reports/reorder?format=csv", headers=admin)
        assert r.headers["content-type"].startswith("text/csv")
        assert "WIRE-122NM" in r.text

    def test_usage_by_tech(self, client, seeded):
        admin = login_admin(client)
        tech = login_tech(client, seeded)
        receive(client, admin, seeded, "romex", "1000", "0.85")
        client.post("/api/v1/transactions/sign-out", headers=tech, json={
            "item_id": seeded["romex"].id, "qty": "50",
            "from_location_id": seeded["shop"].id, "job_id": seeded["job"].id})
        r = client.get("/api/v1/reports/usage-by-tech", headers=admin)
        techs = r.json()["techs"]
        assert techs[0]["user_name"] == "Mike"
        assert Decimal(str(techs[0]["total_cost"])) == Decimal("42.50")  # 50 * 0.85

    def test_recount_needed_on_dashboard(self, client, seeded):
        admin = login_admin(client)
        receive(client, admin, seeded, "box", "5", "1.95")
        # sign-out/transfer oversell is blocked outright now, so the only way
        # stock still goes negative is a count-correction ADJUST (its whole
        # purpose is reconciling a wrong count, including one that turns out
        # to have been short all along).
        client.post("/api/v1/transactions/adjust", headers=admin, json={
            "item_id": seeded["box"].id, "qty": "8", "location_id": seeded["shop"].id,
            "direction": "decrease", "reason": "count_correction", "note": "recount came up short"})
        r = client.get("/api/v1/dashboard/admin", headers=admin)
        recount = r.json()["recount_needed"]
        assert len(recount) == 1 and recount[0]["sku"] == "BOX-4SQ"
        # a count-correction ADJUST clears it
        client.post("/api/v1/transactions/adjust", headers=admin, json={
            "item_id": seeded["box"].id, "qty": "3", "location_id": seeded["shop"].id,
            "direction": "increase", "reason": "count_correction", "note": "recounted shelf"})
        r = client.get("/api/v1/dashboard/admin", headers=admin)
        assert r.json()["recount_needed"] == []


class TestLabels:
    def test_label_sheet_renders(self, client, seeded):
        admin = login_admin(client)
        r = client.post("/api/v1/labels/print", headers=admin, json={
            "item_ids": [seeded["romex"].id, seeded["box"].id]})
        assert r.status_code == 200
        assert "Avery" in r.text or "label" in r.text
        assert "WIRE-122NM" in r.text
        assert "<svg" in r.text  # QR rendered inline
