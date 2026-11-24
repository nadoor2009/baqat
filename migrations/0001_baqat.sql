CREATE TABLE merchants (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0,1))
) STRICT;

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(user_id),
  name TEXT NOT NULL,
  venue TEXT NOT NULL,
  district TEXT NOT NULL,
  address TEXT NOT NULL,
  north INTEGER NOT NULL CHECK (north IN (0,1)),
  latitude REAL NOT NULL CHECK (latitude BETWEEN 24.35 AND 25.10),
  longitude REAL NOT NULL CHECK (longitude BETWEEN 46.30 AND 47.10),
  price_halalas INTEGER NOT NULL CHECK (price_halalas BETWEEN 100 AND 10000000),
  people INTEGER NOT NULL CHECK (people BETWEEN 1 AND 100),
  meal TEXT NOT NULL CHECK (meal IN ('lunch','dinner','both')),
  inclusions TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK (ends_at > starts_at),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1))
) STRICT;
CREATE INDEX offers_search ON offers(published, price_halalas, id);
CREATE INDEX offers_by_merchant ON offers(merchant_id, starts_at);

CREATE TABLE vouchers (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  customer_id TEXT NOT NULL,
  offer_id TEXT NOT NULL REFERENCES offers(id),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT
) STRICT;
CREATE INDEX vouchers_by_customer ON vouchers(customer_id, issued_at);
