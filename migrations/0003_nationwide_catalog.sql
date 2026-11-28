ALTER TABLE offers RENAME TO offers_riyadh;
ALTER TABLE vouchers RENAME TO vouchers_riyadh;

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(user_id),
  name TEXT NOT NULL,
  venue TEXT NOT NULL,
  district TEXT NOT NULL,
  address TEXT NOT NULL,
  north INTEGER NOT NULL CHECK (north IN (0,1)),
  latitude REAL NOT NULL CHECK (latitude BETWEEN 16.3 AND 32.2),
  longitude REAL NOT NULL CHECK (longitude BETWEEN 34.4 AND 56.0),
  price_halalas INTEGER NOT NULL CHECK (price_halalas BETWEEN 100 AND 10000000),
  people INTEGER NOT NULL CHECK (people BETWEEN 1 AND 100),
  meal TEXT NOT NULL CHECK (meal IN ('lunch','dinner','both')),
  inclusions TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK (ends_at > starts_at),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  image_url TEXT,
  city TEXT NOT NULL DEFAULT 'الرياض',
  category TEXT NOT NULL DEFAULT 'food'
    CHECK (category IN ('food', 'fun', 'travel', 'stay', 'other', 'sports', 'wellness', 'shopping', 'events', 'learning', 'services'))
) STRICT;
CREATE TABLE vouchers (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  customer_id TEXT NOT NULL,
  offer_id TEXT NOT NULL REFERENCES offers(id),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT
) STRICT;
INSERT INTO offers (
  id, merchant_id, name, venue, district, address, north, latitude, longitude,
  price_halalas, people, meal, inclusions, starts_at, ends_at, published, image_url
)
SELECT id, merchant_id, name, venue, district, address, north, latitude, longitude,
       price_halalas, people, meal, inclusions, starts_at, ends_at, published, image_url
FROM offers_riyadh;

INSERT INTO vouchers (token_hash, customer_id, offer_id, issued_at, expires_at, redeemed_at)
SELECT token_hash, customer_id, offer_id, issued_at, expires_at, redeemed_at FROM vouchers_riyadh;

DROP TABLE vouchers_riyadh;
DROP TABLE offers_riyadh;

CREATE INDEX offers_search ON offers(published, price_halalas, id);
CREATE INDEX offers_by_merchant ON offers(merchant_id, starts_at);
CREATE INDEX vouchers_by_customer ON vouchers(customer_id, issued_at);
CREATE INDEX offers_catalog_location ON offers(city, category, price_halalas) WHERE published = 1;
