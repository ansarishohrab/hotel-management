CREATE TABLE IF NOT EXISTS admin_users (
  firebase_uid TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254),
  role VARCHAR(40) NOT NULL CHECK (
    role IN ('Owner', 'General manager', 'Front desk manager', 'Other')
  ),
  primary_hotel_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid TEXT NOT NULL REFERENCES admin_users(firebase_uid) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  property_type VARCHAR(40) NOT NULL CHECK (
    property_type IN ('Hotel', 'Resort', 'Guesthouse', 'Other')
  ),
  street_address VARCHAR(240) NOT NULL,
  city VARCHAR(120) NOT NULL,
  region VARCHAR(120) NOT NULL DEFAULT '',
  postal_code VARCHAR(24) NOT NULL DEFAULT '',
  country VARCHAR(40) NOT NULL CHECK (country IN ('India', 'United States')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hotels_owner_uid_idx ON hotels (owner_uid);
