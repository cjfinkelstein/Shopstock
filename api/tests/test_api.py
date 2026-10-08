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


class TestIdempotency:
    """A retried sign-out (same client_ref) must replay, not double-write --
    this is what makes a client-side offline write queue safe to retry."""

    def test_repeated_client_ref_replays(self, client, seeded):
        admin = login_admin(client)
        tech = login_tech(client, seeded)
        receive(client, admin, seeded, "box", "10", "2.00")

        body = {"item_id": seeded["box"].id, "qty": "3", "from_location_id": seeded["shop"].id,
                "job_id": seeded["job"].id, "client_ref": "offline-xyz"}
        r1 = client.post("/api/v1/transactions/sign-out", headers=tech, json=body)
        assert r1.status_code == 201, r1.text
        r2 = client.post("/api/v1/transactions/sign-out", headers=tech, json=body)  # retry
        assert r2.status_code == 201, r2.text
        assert r1.json()["id"] == r2.json()["id"]

        stock = client.get("/api/v1/stock", headers=admin).json()
        row = next(s for s in stock if s["item_id"] == seeded["box"].id
                   and s["location_id"] == seeded["shop"].id)
        assert Decimal(str(row["qty"])) == Decimal("7")  # decremented once, not twice

    def test_repeated_ping_client_ref_replays(self, client, seeded):
        """Same story for a GPS ping queued offline and replayed on sync --
        a retry (same client_ref) must not write a duplicate point into the
        shift's route."""
        tech = login_tech(client, seeded)
        r = client.post("/api/v1/time/gps-consent", headers=tech)
        assert r.status_code == 200, r.text
        r = client.post("/api/v1/time/clock-in", headers=tech, json={"job_id": seeded["job"].id})
        assert r.status_code == 200, r.text
        event_id = r.json()["clock_event_id"]

        body = {"lat": 40.1, "lng": -74.1, "recorded_at": "2026-09-30T12:00:00Z",
                "client_ref": "offline-ping-1"}
        r1 = client.post("/api/v1/time/ping", headers=tech, json=body)
        assert r1.status_code == 204, r1.text
        r2 = client.post("/api/v1/time/ping", headers=tech, json=body)  # retry
        assert r2.status_code == 204, r2.text

        admin = login_admin(client)
        route = client.get(f"/api/v1/time/{event_id}/route", headers=admin).json()
        pings = [p for p in route["points"] if p["kind"] == "ping"]
        assert len(pings) == 1  # recorded once, not twice
        assert pings[0]["at"].startswith("2026-09-30T12:00:00")  # the captured time, not sync time


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


class TestSharedCalendarPermissions:
    """Everyone can read the shared calendar; only admin + a tech named
    Ray can write to it (owner request -- see require_calendar_editor)."""

    def login_as(self, client, user_id):
        r = client.post("/api/v1/auth/tap", json={"user_id": user_id})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    def test_regular_tech_can_read_but_not_write(self, client, seeded):
        tech = login_tech(client, seeded)
        r = client.get("/api/v1/calendar", headers=tech)
        assert r.status_code == 200, r.text

        r = client.post("/api/v1/calendar", headers=tech,
                         json={"event_date": "2026-10-10", "title": "Pick up supplies"})
        assert r.status_code == 403, r.text

    def test_ray_can_write_other_tech_cannot(self, client, seeded, db_session):
        from app.models import User

        ray = User(name="Ray", role="tech", active=True)
        db_session.add(ray)
        db_session.commit()
        ray_hdrs = self.login_as(client, ray.id)

        r = client.post("/api/v1/calendar", headers=ray_hdrs,
                         json={"event_date": "2026-10-10", "title": "Order breakers"})
        assert r.status_code == 201, r.text
        event_id = r.json()["id"]

        r = client.patch(f"/api/v1/calendar/{event_id}", headers=ray_hdrs, json={"done": True})
        assert r.status_code == 200, r.text
        assert r.json()["done"] is True

        other_tech = login_tech(client, seeded)
        r = client.patch(f"/api/v1/calendar/{event_id}", headers=other_tech, json={"done": False})
        assert r.status_code == 403, r.text

    def test_ray_matched_by_first_name_only(self, client, seeded, db_session):
        """Regression test: Ray's real account is stored as the full
        "Raymond Bailey", not just "Ray" -- the match has to be on his
        first name, not the whole name field."""
        from app.models import User

        raymond = User(name="Raymond Bailey", role="tech", active=True)
        db_session.add(raymond)
        db_session.commit()
        raymond_hdrs = self.login_as(client, raymond.id)

        r = client.post("/api/v1/calendar", headers=raymond_hdrs,
                         json={"event_date": "2026-10-10", "title": "Pick up fixtures"})
        assert r.status_code == 201, r.text

    def test_assignee_round_trips(self, client, seeded, db_session):
        """Ray's per-person task list for a date: assignee is a free-text
        label (not tied to a real User), so it just needs to save and come
        back unchanged -- no name-matching involved."""
        from app.models import User

        ray = User(name="Ray", role="tech", active=True)
        db_session.add(ray)
        db_session.commit()
        ray_hdrs = self.login_as(client, ray.id)

        r = client.post("/api/v1/calendar", headers=ray_hdrs, json={
            "event_date": "2026-10-10", "title": "Adam", "assignee": "Adam",
            "notes": "Clean truck\nPick up supplies",
        })
        assert r.status_code == 201, r.text
        assert r.json()["assignee"] == "Adam"
        assert r.json()["notes"] == "Clean truck\nPick up supplies"

        # a regular, unassigned to-do still has assignee == None
        r = client.get("/api/v1/calendar", headers=ray_hdrs)
        assert r.status_code == 200, r.text

    def test_assignee_can_complete_own_task_only(self, client, seeded, db_session):
        """A tech can check off their OWN assigned task (clock-out review),
        but can't retitle it, touch someone else's task, or touch a
        general to-do -- only the done flag, only on their own row."""
        from app.models import User

        ray = User(name="Ray", role="tech", active=True)
        adam = User(name="Adam", role="tech", active=True)
        other = User(name="Sam", role="tech", active=True)
        db_session.add_all([ray, adam, other])
        db_session.commit()
        ray_hdrs = self.login_as(client, ray.id)
        adam_hdrs = self.login_as(client, adam.id)
        other_hdrs = self.login_as(client, other.id)

        r = client.post("/api/v1/calendar", headers=ray_hdrs, json={
            "event_date": "2026-10-10", "title": "Clean the truck", "assignee": "Adam",
        })
        assert r.status_code == 201, r.text
        task_id = r.json()["id"]

        # Adam can mark his own task done
        r = client.patch(f"/api/v1/calendar/{task_id}", headers=adam_hdrs, json={"done": True})
        assert r.status_code == 200, r.text
        assert r.json()["done"] is True

        # but Adam can't retitle it
        r = client.patch(f"/api/v1/calendar/{task_id}", headers=adam_hdrs, json={"title": "Something else"})
        assert r.status_code == 403, r.text

        # a different tech can't touch Adam's task at all
        r = client.patch(f"/api/v1/calendar/{task_id}", headers=other_hdrs, json={"done": False})
        assert r.status_code == 403, r.text

        # Adam can't touch a general (unassigned) to-do either
        r = client.post("/api/v1/calendar", headers=ray_hdrs,
                         json={"event_date": "2026-10-10", "title": "Office closed"})
        assert r.status_code == 201, r.text
        general_id = r.json()["id"]
        r = client.patch(f"/api/v1/calendar/{general_id}", headers=adam_hdrs, json={"done": True})
        assert r.status_code == 403, r.text

    def test_admin_can_still_write(self, client, seeded):
        admin = login_admin(client)
        r = client.post("/api/v1/calendar", headers=admin,
                         json={"event_date": "2026-10-10", "title": "Schedule inspection"})
        assert r.status_code == 201, r.text


class TestClockOut:
    def test_clock_out_without_a_note_succeeds(self, client, seeded):
        """A tech can clock out without writing anything -- the note is
        optional, not required."""
        tech = login_tech(client, seeded)
        r = client.post("/api/v1/time/gps-consent", headers=tech)
        assert r.status_code == 200, r.text
        r = client.post("/api/v1/time/clock-in", headers=tech, json={"job_id": seeded["job"].id})
        assert r.status_code == 200, r.text
        r = client.post("/api/v1/time/clock-out", headers=tech, json={})
        assert r.status_code == 200, r.text


class TestClockOutPhotos:
    def _clock_in(self, client, hdrs, seeded):
        r = client.post("/api/v1/time/gps-consent", headers=hdrs)
        assert r.status_code == 200, r.text
        r = client.post("/api/v1/time/clock-in", headers=hdrs, json={"job_id": seeded["job"].id})
        assert r.status_code == 200, r.text

    def test_upload_and_fetch_own_photo(self, client, seeded, tmp_path, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))

        tech = login_tech(client, seeded)
        self._clock_in(client, tech, seeded)

        fake_jpeg = b"\xff\xd8\xff\xe0" + b"0" * 100
        r = client.post(
            "/api/v1/time/clock-out/photos", headers=tech,
            files={"file": ("site.jpg", fake_jpeg, "image/jpeg")},
            data={"caption": "Panel before repair"},
        )
        assert r.status_code == 201, r.text
        photo = r.json()
        assert photo["caption"] == "Panel before repair"
        assert photo["url"] == f"/time/photos/{photo['id']}"

        r = client.get(f"/api/v1/time/photos/{photo['id']}", headers=tech)
        assert r.status_code == 200, r.text
        assert r.content == fake_jpeg

    def test_admin_and_any_tech_can_see_a_photo(self, client, seeded, db_session, tmp_path, monkeypatch):
        """Photos are a shared feed -- unlike clock_out_note (admin-only),
        any logged-in user can view any tech's clock-out photo."""
        from app.config import settings
        from app.models import User

        monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))

        tech = login_tech(client, seeded)
        self._clock_in(client, tech, seeded)
        r = client.post(
            "/api/v1/time/clock-out/photos", headers=tech,
            files={"file": ("site.jpg", b"fake-bytes", "image/jpeg")},
        )
        assert r.status_code == 201, r.text
        photo_id = r.json()["id"]

        admin = login_admin(client)
        r = client.get(f"/api/v1/time/photos/{photo_id}", headers=admin)
        assert r.status_code == 200, r.text

        other = User(name="Sam", role="tech", active=True)
        db_session.add(other)
        db_session.commit()
        r = client.post("/api/v1/auth/tap", json={"user_id": other.id})
        other_hdrs = {"Authorization": f"Bearer {r.json()['access_token']}"}
        r = client.get(f"/api/v1/time/photos/{photo_id}", headers=other_hdrs)
        assert r.status_code == 200, r.text

    def test_photo_feed_lists_uploader_date_and_caption(self, client, seeded, db_session, tmp_path, monkeypatch):
        from app.config import settings
        from app.models import User

        monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))

        tech = login_tech(client, seeded)
        self._clock_in(client, tech, seeded)
        r = client.post(
            "/api/v1/time/clock-out/photos", headers=tech,
            files={"file": ("site.jpg", b"fake-bytes", "image/jpeg")},
            data={"caption": "Panel before repair"},
        )
        assert r.status_code == 201, r.text

        other = User(name="Sam", role="tech", active=True)
        db_session.add(other)
        db_session.commit()
        r = client.post("/api/v1/auth/tap", json={"user_id": other.id})
        other_hdrs = {"Authorization": f"Bearer {r.json()['access_token']}"}

        r = client.get("/api/v1/time/photos", headers=other_hdrs)
        assert r.status_code == 200, r.text
        feed = r.json()
        assert len(feed) == 1
        assert feed[0]["caption"] == "Panel before repair"
        assert feed[0]["uploaded_by_name"] == seeded["tech"].name
        assert feed[0]["shift_date"]

    def test_rejects_non_image_upload(self, client, seeded, tmp_path, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))

        tech = login_tech(client, seeded)
        self._clock_in(client, tech, seeded)
        r = client.post(
            "/api/v1/time/clock-out/photos", headers=tech,
            files={"file": ("notes.pdf", b"%PDF-fake", "application/pdf")},
        )
        assert r.status_code == 400, r.text

    def test_upload_allowed_while_clocked_out(self, client, seeded, tmp_path, monkeypatch):
        """A tech can add a photo any time, not just during a shift -- it
        just has no clock_event_id, and the feed falls back to the upload
        date instead of a shift date."""
        from app.config import settings
        monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))

        tech = login_tech(client, seeded)
        r = client.post(
            "/api/v1/time/clock-out/photos", headers=tech,
            files={"file": ("site.jpg", b"fake-bytes", "image/jpeg")},
            data={"caption": "Spare parts in the van"},
        )
        assert r.status_code == 201, r.text
        photo_id = r.json()["id"]

        r = client.get(f"/api/v1/time/photos/{photo_id}", headers=tech)
        assert r.status_code == 200, r.text

        r = client.get("/api/v1/time/photos", headers=tech)
        assert r.status_code == 200, r.text
        feed = [p for p in r.json() if p["id"] == photo_id]
        assert len(feed) == 1
        assert feed[0]["caption"] == "Spare parts in the van"
        assert feed[0]["shift_date"]
