CREATE TABLE IF NOT EXISTS admin_users (
  firebase_uid TEXT PRIMARY KEY,
  phone_number TEXT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254),
  role VARCHAR(40) NOT NULL CHECK (
    role IN ('Owner', 'General manager', 'Front desk manager', 'Other')
  ),
  primary_hotel_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_users ALTER COLUMN phone_number DROP NOT NULL;

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

CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_number VARCHAR(20) NOT NULL,
  room_type VARCHAR(40) NOT NULL CHECK (
    room_type IN ('Standard', 'Deluxe', 'Suite', 'Family')
  ),
  capacity SMALLINT NOT NULL CHECK (capacity BETWEEN 1 AND 12),
  nightly_rate NUMERIC(10, 2) NOT NULL CHECK (nightly_rate > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'Available' CHECK (
    status IN ('Available', 'Occupied', 'Cleaning', 'Maintenance')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, room_number)
);

CREATE INDEX IF NOT EXISTS rooms_hotel_id_idx ON rooms (hotel_id);
CREATE UNIQUE INDEX IF NOT EXISTS rooms_id_hotel_id_uidx ON rooms (id, hotel_id);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_id UUID NOT NULL,
  created_by_uid TEXT NOT NULL REFERENCES admin_users(firebase_uid) ON DELETE CASCADE,
  guest_name VARCHAR(120) NOT NULL,
  guest_email VARCHAR(254),
  guest_phone VARCHAR(32),
  guest_count SMALLINT NOT NULL CHECK (guest_count BETWEEN 1 AND 12),
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  nightly_rate NUMERIC(10, 2) NOT NULL CHECK (nightly_rate > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'Booked' CHECK (
    status IN ('Booked', 'Checked-in', 'Checked-out', 'Cancelled')
  ),
  checked_in_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (check_out_date > check_in_date),
  CHECK (
    (status IN ('Booked', 'Cancelled') AND checked_in_at IS NULL AND checked_out_at IS NULL)
    OR (status = 'Checked-in' AND checked_in_at IS NOT NULL AND checked_out_at IS NULL)
    OR (status = 'Checked-out' AND checked_in_at IS NOT NULL AND checked_out_at IS NOT NULL)
  ),
  CHECK (checked_out_at IS NULL OR checked_in_at <= checked_out_at),
  FOREIGN KEY (room_id, hotel_id) REFERENCES rooms(id, hotel_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS bookings_hotel_dates_idx
  ON bookings (hotel_id, check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS bookings_room_status_idx
  ON bookings (room_id, status);
