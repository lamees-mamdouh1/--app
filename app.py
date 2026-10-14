import os, sqlite3
from datetime import date, timedelta
from flask import Flask, request, jsonify, session, g
from werkzeug.security import generate_password_hash, check_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "rehlaty.db")
app = Flask(__name__, static_folder="static", static_url_path="")
app.secret_key = os.environ.get("SECRET_KEY", "dev-only-change-me")
app.permanent_session_lifetime = timedelta(days=30)  # الجلسة بتفضل محفوظة 30 يوم


@app.before_request
def keep_session():
    session.permanent = True

CITIES = {"CAI": "القاهرة", "HRG": "الغردقة", "SSH": "شرم الشيخ", "LXR": "الأقصر",
          "ASW": "أسوان", "DXB": "دبي", "JED": "جدة", "RUH": "الرياض", "IST": "إسطنبول"}
ROUTES = [("CAI", "HRG", 75, 1800), ("CAI", "SSH", 80, 2000), ("CAI", "LXR", 70, 1500),
          ("CAI", "ASW", 105, 1700), ("CAI", "DXB", 240, 9500), ("CAI", "JED", 150, 6500),
          ("CAI", "RUH", 170, 7200), ("CAI", "IST", 190, 8800)]
AIRLINES = ["مصر للطيران", "نايل إير", "إير كايرو"]
TIMES = ["07:30", "13:15", "19:45"]
HOTELS = [("فندق ريفييرا", 900), ("منتجع الواحة", 1800), ("جراند بالاس", 3600)]


def init_db():
    c = sqlite3.connect(DB)
    c.executescript(open(os.path.join(BASE, "schema.sql"), encoding="utf-8").read())
    if not c.execute("SELECT 1 FROM flights LIMIT 1").fetchone():  # بيانات تجريبية
        for a, b, mins, price in ROUTES:
            for o, d in ((a, b), (b, a)):
                for i, t in enumerate(TIMES):
                    c.execute("INSERT INTO flights(origin,dest,airline,depart_time,duration_min,price) VALUES(?,?,?,?,?,?)",
                              (o, d, AIRLINES[i], t, mins, price + i * 150))
        for code, city in CITIES.items():
            for i, (h, price) in enumerate(HOTELS):
                c.execute("INSERT INTO hotels(city,name,stars,price_per_night,rating) VALUES(?,?,?,?,?)",
                          (code, f"{h} {city}", 3 + i, price, round(7.4 + i * 0.8, 1)))
    c.commit(); c.close()


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_):
    d = g.pop("db", None)
    if d:
        d.close()


def err(msg, code=400):
    return jsonify(error=msg), code


def to_int(v, default=1):
    try:
        return max(1, min(int(v), 20))
    except (TypeError, ValueError):
        return default


def valid_date(s):
    try:
        return date.fromisoformat(s) >= date.today()
    except (TypeError, ValueError):
        return False


def _factor(day, key):
    """السعر بيتغير حسب قرب الموعد، ويوم الأسبوع، والموسم، وتذبذب بسيط."""
    ahead = (day - date.today()).days
    f = 0.85 if ahead >= 30 else 1.0 if ahead >= 14 else 1.12 if ahead >= 7 else 1.28
    if day.weekday() in (3, 4):
        f *= 1.12  # الخميس والجمعة
    if day.month in (7, 8, 12):
        f *= 1.2  # مواسم الذروة
    return f * (1 + ((key * 7 + day.toordinal()) % 11 - 5) / 100)


def flight_price(r, day):
    return round(r["price"] * (0.88 if flight_info(r)[0] else 1) * _factor(date.fromisoformat(day), r["id"]) / 10) * 10


def hotel_total(r, a, b):
    d0 = date.fromisoformat(a)
    n = (date.fromisoformat(b) - d0).days
    return sum(round(r["price_per_night"] * _factor(d0 + timedelta(i), r["id"]) / 10) * 10 for i in range(n))


INTL = {"DXB", "JED", "RUH", "IST"}
CABIN = {"economy": 1.0, "business": 2.6}
CURRENCIES = {"EGP": {"rate": 1, "symbol": "ج.م"}, "USD": {"rate": 0.0205, "symbol": "$"},
              "SAR": {"rate": 0.077, "symbol": "ر.س"}, "EUR": {"rate": 0.0189, "symbol": "€"}}  # أسعار صرف تجريبية، اربطها بمصدر حي عند النشر


def flight_info(r):
    stops = 1 if r["airline"] == "إير كايرو" and (r["origin"] in INTL or r["dest"] in INTL) else 0
    return stops, r["duration_min"] + 85 * stops


def return_price(r, ret, mult):
    rv = db().execute("SELECT * FROM flights WHERE origin=? AND dest=? AND airline=? ORDER BY depart_time LIMIT 1",
                      (r["dest"], r["origin"], r["airline"])).fetchone()
    return round(flight_price(rv, ret) * mult / 10) * 10 if rv else 0


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/cities")
def cities():
    return jsonify([{"code": k, "name": v} for k, v in CITIES.items()])


# ---------- الحساب ----------
@app.post("/api/register")
def register():
    j = request.get_json(silent=True) or {}
    name, email, pw = (j.get("name") or "").strip(), (j.get("email") or "").strip().lower(), j.get("password") or ""
    if not name or "@" not in email or len(pw) < 6:
        return err("اكتب الاسم وإيميل صحيح وكلمة سر 6 حروف على الأقل")
    try:
        cur = db().execute("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
                           (name, email, generate_password_hash(pw)))
        db().commit()
    except sqlite3.IntegrityError:
        return err("الإيميل ده مسجل قبل كده", 409)
    session["uid"] = cur.lastrowid
    return jsonify(id=cur.lastrowid, name=name), 201


@app.post("/api/login")
def login():
    j = request.get_json(silent=True) or {}
    u = db().execute("SELECT * FROM users WHERE email=?", ((j.get("email") or "").strip().lower(),)).fetchone()
    if not u or not check_password_hash(u["password_hash"], j.get("password") or ""):
        return err("الإيميل أو كلمة السر غلط", 401)
    session["uid"] = u["id"]
    return jsonify(id=u["id"], name=u["name"])


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    u = db().execute("SELECT id,name FROM users WHERE id=?", (session.get("uid"),)).fetchone()
    return jsonify(dict(u) if u else None)


# ---------- البحث ----------
@app.get("/api/rates")
def rates():
    return jsonify(CURRENCIES)


@app.get("/api/offers")
def offers():
    day = (date.today() + timedelta(days=21)).isoformat()
    out = []
    for o, d, *_ in ROUTES:
        rows = db().execute("SELECT * FROM flights WHERE origin=? AND dest=?", (o, d)).fetchall()
        best = min(flight_price(r, day) for r in rows)
        out.append({"origin": o, "dest": d, "origin_name": CITIES[o], "dest_name": CITIES[d], "price": best, "date": day})
    return jsonify(sorted(out, key=lambda x: x["price"])[:6])


@app.get("/api/flights")
def flights():
    o, d, day = request.args.get("from"), request.args.get("to"), request.args.get("date")
    n, ret = to_int(request.args.get("passengers")), request.args.get("return_date") or None
    mult = CABIN.get(request.args.get("cabin", "economy"), 1.0)
    if o not in CITIES or d not in CITIES or o == d:
        return err("اختار مدينة سفر ومدينة وصول مختلفتين")
    if not valid_date(day):
        return err("التاريخ لازم يكون النهارده أو بعده")
    if ret and (not valid_date(ret) or ret < day):
        return err("تاريخ العودة لازم يكون بعد تاريخ السفر")
    rows = db().execute("SELECT * FROM flights WHERE origin=? AND dest=? ORDER BY depart_time", (o, d)).fetchall()
    out = []
    for r in rows:
        stops, dur = flight_info(r)
        p = round(flight_price(r, day) * mult / 10) * 10 + (return_price(r, ret, mult) if ret else 0)
        out.append({**dict(r), "stops": stops, "duration_min": dur, "price": p, "total": p * n,
                    "round_trip": bool(ret), "origin_name": CITIES[o], "dest_name": CITIES[d]})
    return jsonify(out)


@app.get("/api/hotels")
def hotels():
    city, a, b = request.args.get("city"), request.args.get("checkin"), request.args.get("checkout")
    rooms = to_int(request.args.get("rooms"))
    if city not in CITIES:
        return err("اختار المدينة")
    if not valid_date(a) or not valid_date(b) or b <= a:
        return err("تاريخ الخروج لازم يكون بعد تاريخ الدخول")
    nights = (date.fromisoformat(b) - date.fromisoformat(a)).days
    rows = db().execute("SELECT * FROM hotels WHERE city=? ORDER BY price_per_night", (city,)).fetchall()
    out = []
    for r in rows:
        t = hotel_total(r, a, b)
        out.append({**dict(r), "city_name": CITIES[city], "nights": nights, "price_per_night": round(t / nights), "total": t * rooms})
    return jsonify(out)


# ---------- الحجوزات ----------
@app.post("/api/bookings")
def book():
    uid = session.get("uid")
    if not uid:
        return err("سجّل دخولك الأول", 401)
    j = request.get_json(silent=True) or {}
    kind, start, end, qty = j.get("type"), j.get("date"), j.get("end_date"), to_int(j.get("qty"))
    if not valid_date(start):
        return err("التاريخ غير صحيح")
    if kind == "flight":
        r = db().execute("SELECT * FROM flights WHERE id=?", (j.get("item_id"),)).fetchone()
        if not r:
            return err("الرحلة مش موجودة", 404)
        mult, ret = CABIN.get(j.get("cabin"), 1.0), j.get("return_date") or None
        if ret and (not valid_date(ret) or ret < start):
            return err("تاريخ العودة لازم يكون بعد تاريخ السفر")
        p = round(flight_price(r, start) * mult / 10) * 10 + (return_price(r, ret, mult) if ret else 0)
        title = (f"{CITIES[r['origin']]} إلى {CITIES[r['dest']]} - {r['airline']} - {r['depart_time']}"
                 + (" - ذهاب وعودة" if ret else "") + (" - رجال أعمال" if mult > 1 else ""))
        total, end = p * qty, ret
    elif kind == "hotel":
        r = db().execute("SELECT * FROM hotels WHERE id=?", (j.get("item_id"),)).fetchone()
        if not r:
            return err("الفندق مش موجود", 404)
        if not valid_date(end) or end <= start:
            return err("تاريخ الخروج لازم يكون بعد الدخول")
        title = r["name"]
        total = hotel_total(r, start, end) * qty
    else:
        return err("نوع الحجز غير صحيح")
    cur = db().execute("INSERT INTO bookings(user_id,type,item_id,title,start_date,end_date,qty,total) VALUES(?,?,?,?,?,?,?,?)",
                       (uid, kind, r["id"], title, start, end, qty, total))
    db().commit()
    return jsonify(id=cur.lastrowid, total=total), 201


@app.get("/api/bookings")
def my_bookings():
    uid = session.get("uid")
    if not uid:
        return err("سجّل دخولك الأول", 401)
    rows = db().execute("SELECT * FROM bookings WHERE user_id=? ORDER BY id DESC", (uid,)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.delete("/api/bookings/<int:bid>")
def cancel(bid):
    uid = session.get("uid")
    if not uid:
        return err("سجّل دخولك الأول", 401)
    cur = db().execute("UPDATE bookings SET status='cancelled' WHERE id=? AND user_id=?", (bid, uid))
    db().commit()
    return jsonify(ok=True) if cur.rowcount else err("الحجز مش موجود", 404)


init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
    