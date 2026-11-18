const fs = require('node:fs/promises')
const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '.env') })

const express = require('express')
const { getAuth } = require('firebase-admin/auth')
const { getApp, getApps, initializeApp } = require('firebase-admin/app')
const { Pool } = require('pg')

const port = Number(process.env.PORT || 3000)
const projectId = process.env.FIREBASE_PROJECT_ID

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Configure backend/.env for local PostgreSQL.')
}

if (!projectId) {
  throw new Error('FIREBASE_PROJECT_ID is required to verify Firebase Auth tokens.')
}

const firebaseApp = getApps().length > 0
  ? getApp()
  : initializeApp({ projectId })
const firebaseAuth = getAuth(firebaseApp)
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const app = express()

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

app.use(express.json({ limit: '16kb' }))

async function requireFirebaseUser(req, res, next) {
  const authorization = req.get('authorization') || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    res.status(401).json({ error: 'Sign in to continue.' })
    return
  }

  try {
    const decodedToken = await firebaseAuth.verifyIdToken(match[1])
    if (typeof decodedToken.email !== 'string' || !decodedToken.email) {
      res.status(401).json({ error: 'A Firebase email account is required.' })
      return
    }

    req.firebaseUser = decodedToken
    next()
  } catch (error) {
    const invalidTokenCodes = new Set([
      'auth/argument-error',
      'auth/id-token-expired',
      'auth/invalid-id-token',
      'auth/user-disabled',
    ])

    if (invalidTokenCodes.has(error.code)) {
      res.status(401).json({ error: 'Your sign-in is invalid or has expired. Sign in again.' })
      return
    }

    console.error('Firebase ID token verification failed:', error)
    res.status(503).json({ error: 'Sign-in verification is temporarily unavailable.' })
  }
}

function readString(value, maxLength) {
  return typeof value === 'string' && value.trim().length <= maxLength
    ? value.trim()
    : null
}

function mapHotel(row) {
  if (!row?.hotel_id) return null

  return {
    id: row.hotel_id,
    name: row.hotel_name,
    propertyType: row.property_type,
    address: {
      street: row.street_address,
      city: row.city,
      region: row.region,
      postalCode: row.postal_code,
      country: row.country,
    },
  }
}

function mapRoom(row) {
  return {
    id: row.id,
    roomNumber: row.room_number,
    roomType: row.room_type,
    capacity: row.capacity,
    nightlyRate: Number(row.nightly_rate),
    status: row.status,
  }
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsedDate = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value
}

function mapBooking(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    roomNumber: row.room_number,
    roomType: row.room_type,
    guestName: row.guest_name,
    guestEmail: row.guest_email || '',
    guestPhone: row.guest_phone || '',
    guestCount: row.guest_count,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    nightlyRate: Number(row.nightly_rate),
    status: row.status,
    checkedInAt: row.checked_in_at,
    checkedOutAt: row.checked_out_at,
    createdAt: row.created_at,
  }
}

const bookingSelect = `SELECT
  booking.id::text,
  booking.room_id::text,
  room.room_number,
  room.room_type,
  booking.guest_name,
  booking.guest_email,
  booking.guest_phone,
  booking.guest_count,
  booking.check_in_date::text,
  booking.check_out_date::text,
  booking.nightly_rate,
  booking.status,
  booking.checked_in_at,
  booking.checked_out_at,
  booking.created_at
FROM bookings AS booking
JOIN rooms AS room
  ON room.id = booking.room_id
  AND room.hotel_id = booking.hotel_id`

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', database: 'connected' })
  } catch (error) {
    console.error('PostgreSQL health check failed:', error)
    res.status(503).json({ status: 'error', database: 'unavailable' })
  }
})

app.get('/api/rooms', requireFirebaseUser, async (req, res) => {
  try {
    const hotelResult = await pool.query(
      `SELECT hotel.id::text AS hotel_id, hotel.name, hotel.city
       FROM admin_users AS admin
       JOIN hotels AS hotel
         ON hotel.id = admin.primary_hotel_id
         AND hotel.owner_uid = admin.firebase_uid
       WHERE admin.firebase_uid = $1`,
      [req.firebaseUser.uid],
    )
    const hotel = hotelResult.rows[0]

    if (!hotel) {
      res.status(409).json({ error: 'Save your hotel details before managing rooms.' })
      return
    }

    const roomsResult = await pool.query(
      `SELECT id::text, room_number, room_type, capacity, nightly_rate, status
       FROM rooms
       WHERE hotel_id = $1
       ORDER BY room_number`,
      [hotel.hotel_id],
    )

    res.json({
      hotel: { id: hotel.hotel_id, name: hotel.name, city: hotel.city },
      rooms: roomsResult.rows.map(mapRoom),
    })
  } catch (error) {
    console.error('Could not load PostgreSQL rooms:', error)
    res.status(500).json({ error: 'Could not load your rooms.' })
  }
})

app.post('/api/rooms', requireFirebaseUser, async (req, res) => {
  const roomNumber = readString(req.body?.roomNumber, 20)
  const roomType = readString(req.body?.roomType, 40)
  const capacity = req.body?.capacity
  const nightlyRate = req.body?.nightlyRate
  const allowedRoomTypes = ['Standard', 'Deluxe', 'Suite', 'Family']

  if (!roomNumber) {
    res.status(400).json({ error: 'Enter a room number.' })
    return
  }

  if (!allowedRoomTypes.includes(roomType)) {
    res.status(400).json({ error: 'Choose a valid room type.' })
    return
  }

  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 12) {
    res.status(400).json({ error: 'Guest capacity must be between 1 and 12.' })
    return
  }

  if (typeof nightlyRate !== 'number' || !Number.isFinite(nightlyRate) || nightlyRate <= 0 || nightlyRate > 99999999) {
    res.status(400).json({ error: 'Enter a valid nightly rate greater than zero.' })
    return
  }

  try {
    const hotelResult = await pool.query(
      `SELECT hotel.id::text AS hotel_id
       FROM admin_users AS admin
       JOIN hotels AS hotel
         ON hotel.id = admin.primary_hotel_id
         AND hotel.owner_uid = admin.firebase_uid
       WHERE admin.firebase_uid = $1`,
      [req.firebaseUser.uid],
    )
    const hotel = hotelResult.rows[0]

    if (!hotel) {
      res.status(409).json({ error: 'Save your hotel details before adding rooms.' })
      return
    }

    const roomResult = await pool.query(
      `INSERT INTO rooms (hotel_id, room_number, room_type, capacity, nightly_rate)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id::text, room_number, room_type, capacity, nightly_rate, status`,
      [hotel.hotel_id, roomNumber, roomType, capacity, nightlyRate],
    )

    res.status(201).json({ room: mapRoom(roomResult.rows[0]) })
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'That room number already exists in your hotel.' })
      return
    }

    console.error('Could not save PostgreSQL room:', error)
    res.status(500).json({ error: 'Could not save the room.' })
  }
})

app.get('/api/bookings', requireFirebaseUser, async (req, res) => {
  try {
    const result = await pool.query(
      `${bookingSelect}
       JOIN hotels AS hotel
         ON hotel.id = booking.hotel_id
         AND hotel.owner_uid = $1
       JOIN admin_users AS admin
         ON admin.firebase_uid = $1
         AND admin.primary_hotel_id = hotel.id
       ORDER BY booking.check_in_date, booking.created_at DESC`,
      [req.firebaseUser.uid],
    )

    res.json({ bookings: result.rows.map(mapBooking) })
  } catch (error) {
    console.error('Could not load PostgreSQL bookings:', error)
    res.status(500).json({ error: 'Could not load your bookings.' })
  }
})

app.post('/api/bookings', requireFirebaseUser, async (req, res) => {
  const roomId = req.body?.roomId
  const guestName = readString(req.body?.guestName, 120)
  const guestEmail = req.body?.guestEmail == null ? '' : readString(req.body.guestEmail, 254)
  const guestPhone = req.body?.guestPhone == null ? '' : readString(req.body.guestPhone, 32)
  const guestCount = req.body?.guestCount
  const checkInDate = req.body?.checkInDate
  const checkOutDate = req.body?.checkOutDate

  if (typeof roomId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roomId)) {
    res.status(400).json({ error: 'Choose a valid room.' })
    return
  }

  if (!guestName || guestName.length < 2) {
    res.status(400).json({ error: 'Enter the guest’s name.' })
    return
  }

  if (guestEmail === null || (guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail))) {
    res.status(400).json({ error: 'Enter a valid guest email address.' })
    return
  }

  if (guestPhone === null) {
    res.status(400).json({ error: 'Enter a valid guest phone number.' })
    return
  }

  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 12) {
    res.status(400).json({ error: 'Guest count must be between 1 and 12.' })
    return
  }

  if (!isDateOnly(checkInDate) || !isDateOnly(checkOutDate) || checkOutDate <= checkInDate) {
    res.status(400).json({ error: 'Choose valid arrival and departure dates. Departure must be after arrival.' })
    return
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const hotelResult = await client.query(
      `SELECT hotel.id::text AS hotel_id
       FROM admin_users AS admin
       JOIN hotels AS hotel
         ON hotel.id = admin.primary_hotel_id
         AND hotel.owner_uid = admin.firebase_uid
       WHERE admin.firebase_uid = $1`,
      [req.firebaseUser.uid],
    )
    const hotel = hotelResult.rows[0]

    if (!hotel) {
      throw new HttpError(409, 'Save your hotel details before creating a booking.')
    }

    const roomResult = await client.query(
      `SELECT id::text, capacity, nightly_rate, status
       FROM rooms
       WHERE id = $1 AND hotel_id = $2
       FOR UPDATE`,
      [roomId, hotel.hotel_id],
    )
    const room = roomResult.rows[0]

    if (!room) {
      throw new HttpError(404, 'That room could not be found in your hotel.')
    }

    if (guestCount > room.capacity) {
      throw new HttpError(400, `This room accommodates up to ${room.capacity} guests.`)
    }

    if (['Cleaning', 'Maintenance'].includes(room.status)) {
      throw new HttpError(409, 'This room is not currently available for booking.')
    }

    const overlapResult = await client.query(
      `SELECT id
       FROM bookings
       WHERE room_id = $1
         AND status <> 'Cancelled'
         AND COALESCE(checked_in_at::date, check_in_date) < $3::date
         AND CASE
           WHEN status = 'Checked-out' THEN checked_out_at::date
           ELSE check_out_date
         END > $2::date
       LIMIT 1`,
      [roomId, checkInDate, checkOutDate],
    )

    if (overlapResult.rowCount > 0) {
      throw new HttpError(409, 'This room already has a booking for some of those dates.')
    }

    const insertResult = await client.query(
      `INSERT INTO bookings (
        hotel_id, room_id, created_by_uid, guest_name, guest_email, guest_phone,
        guest_count, check_in_date, check_out_date, nightly_rate
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id::text`,
      [
        hotel.hotel_id,
        roomId,
        req.firebaseUser.uid,
        guestName,
        guestEmail || null,
        guestPhone || null,
        guestCount,
        checkInDate,
        checkOutDate,
        room.nightly_rate,
      ],
    )
    const savedBookingResult = await client.query(
      `${bookingSelect} WHERE booking.id = $1`,
      [insertResult.rows[0].id],
    )
    await client.query('COMMIT')

    res.status(201).json({ booking: mapBooking(savedBookingResult.rows[0]) })
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error('PostgreSQL booking transaction rollback failed:', rollbackError)
    }

    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message })
      return
    }

    console.error('Could not save PostgreSQL booking:', error)
    res.status(500).json({ error: 'Could not save your booking.' })
  } finally {
    client.release()
  }
})

app.patch('/api/bookings/:bookingId/status', requireFirebaseUser, async (req, res) => {
  const bookingId = req.params.bookingId
  const nextStatus = req.body?.status
  const allowedStatuses = ['Checked-in', 'Checked-out', 'Cancelled']

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bookingId)) {
    res.status(400).json({ error: 'The booking ID is invalid.' })
    return
  }

  if (!allowedStatuses.includes(nextStatus)) {
    res.status(400).json({ error: 'Choose a valid booking status.' })
    return
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const currentResult = await client.query(
      `SELECT booking.id::text, booking.room_id::text, booking.hotel_id::text,
        booking.status, booking.guest_name, booking.guest_email, booking.guest_phone,
        booking.guest_count, booking.check_in_date::text, booking.check_out_date::text,
        booking.nightly_rate, booking.checked_in_at, booking.checked_out_at,
        booking.created_at, room.room_number, room.room_type, room.status AS room_status
       FROM bookings AS booking
       JOIN rooms AS room
         ON room.id = booking.room_id
         AND room.hotel_id = booking.hotel_id
       JOIN hotels AS hotel
         ON hotel.id = booking.hotel_id
         AND hotel.owner_uid = $2
       JOIN admin_users AS admin
         ON admin.firebase_uid = $2
         AND admin.primary_hotel_id = hotel.id
       WHERE booking.id = $1
       FOR UPDATE OF booking, room`,
      [bookingId, req.firebaseUser.uid],
    )
    const booking = currentResult.rows[0]

    if (!booking) {
      throw new HttpError(404, 'That booking could not be found for your hotel.')
    }

    if (nextStatus === 'Checked-in') {
      if (booking.status !== 'Booked') {
        throw new HttpError(409, 'Only a booked reservation can be checked in.')
      }

      if (booking.room_status !== 'Available') {
        throw new HttpError(409, 'This room is not ready for check-in.')
      }

      const currentStayResult = await client.query(
        `SELECT id
         FROM bookings
         WHERE room_id = $1
           AND id <> $2
           AND status = 'Booked'
           AND check_in_date <= CURRENT_DATE
           AND check_out_date > CURRENT_DATE
         LIMIT 1`,
        [booking.room_id, bookingId],
      )

      if (currentStayResult.rowCount > 0) {
        throw new HttpError(409, 'Another guest has a reservation for this room today.')
      }

      await client.query(
        `UPDATE bookings
         SET status = 'Checked-in', checked_in_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [bookingId],
      )
      await client.query(
        `UPDATE rooms SET status = 'Occupied', updated_at = NOW()
         WHERE id = $1`,
        [booking.room_id],
      )
    } else if (nextStatus === 'Checked-out') {
      if (booking.status !== 'Checked-in') {
        throw new HttpError(409, 'Check in the guest before checking them out.')
      }

      await client.query(
        `UPDATE bookings
         SET status = 'Checked-out', checked_out_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [bookingId],
      )
      await client.query(
        `UPDATE rooms SET status = 'Available', updated_at = NOW()
         WHERE id = $1`,
        [booking.room_id],
      )
    } else {
      if (booking.status !== 'Booked') {
        throw new HttpError(409, 'Only a booked reservation can be cancelled.')
      }

      await client.query(
        `UPDATE bookings SET status = 'Cancelled', updated_at = NOW()
         WHERE id = $1`,
        [bookingId],
      )
    }

    const savedBookingResult = await client.query(
      `${bookingSelect} WHERE booking.id = $1`,
      [bookingId],
    )
    await client.query('COMMIT')
    res.json({ booking: mapBooking(savedBookingResult.rows[0]) })
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error('PostgreSQL booking status transaction rollback failed:', rollbackError)
    }

    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message })
      return
    }

    console.error('Could not update PostgreSQL booking status:', error)
    res.status(500).json({ error: 'Could not update the booking status.' })
  } finally {
    client.release()
  }
})

app.get('/api/onboarding', requireFirebaseUser, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        admin.full_name,
        admin.email,
        admin.role,
        hotel.id::text AS hotel_id,
        hotel.name AS hotel_name,
        hotel.property_type,
        hotel.street_address,
        hotel.city,
        hotel.region,
        hotel.postal_code,
        hotel.country
      FROM admin_users AS admin
      LEFT JOIN hotels AS hotel
        ON hotel.id = admin.primary_hotel_id
        AND hotel.owner_uid = admin.firebase_uid
      WHERE admin.firebase_uid = $1`,
      [req.firebaseUser.uid],
    )
    const row = result.rows[0]

    if (!row) {
      res.json({ profile: null, hotel: null })
      return
    }

    res.json({
      profile: {
        fullName: row.full_name,
        email: row.email || '',
        role: row.role,
      },
      hotel: mapHotel(row),
    })
  } catch (error) {
    console.error('Could not load PostgreSQL onboarding data:', error)
    res.status(500).json({ error: 'Could not load your saved setup.' })
  }
})

app.get('/api/onboarding/profile', requireFirebaseUser, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT full_name, email, role
       FROM admin_users
       WHERE firebase_uid = $1`,
      [req.firebaseUser.uid],
    )
    const row = result.rows[0]

    res.json({
      profile: row
        ? {
          fullName: row.full_name,
          email: row.email || '',
          role: row.role,
        }
        : null,
    })
  } catch (error) {
    console.error('Could not load PostgreSQL admin profile:', error)
    res.status(500).json({ error: 'Could not load your profile.' })
  }
})

app.put('/api/onboarding/profile', requireFirebaseUser, async (req, res) => {
  const fullName = readString(req.body?.fullName, 120)
  const email = readString(req.firebaseUser.email, 254)
  const role = readString(req.body?.role, 40)
  const allowedRoles = ['Owner', 'General manager', 'Front desk manager', 'Other']

  if (!fullName || fullName.length < 2) {
    res.status(400).json({ error: 'Enter your full name.' })
    return
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'A valid Firebase account email is required.' })
    return
  }

  if (!allowedRoles.includes(role)) {
    res.status(400).json({ error: 'Choose a valid admin role.' })
    return
  }

  try {
    await pool.query(
      `INSERT INTO admin_users (firebase_uid, full_name, email, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (firebase_uid) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         updated_at = NOW()`,
      [
        req.firebaseUser.uid,
        fullName,
        email,
        role,
      ],
    )

    res.json({
      profile: {
        fullName,
        email,
        role,
      },
    })
  } catch (error) {
    console.error('Could not save PostgreSQL admin profile:', error)
    res.status(500).json({ error: 'Could not save your profile.' })
  }
})

app.put('/api/onboarding/hotel', requireFirebaseUser, async (req, res) => {
  const name = readString(req.body?.name, 160)
  const propertyType = readString(req.body?.propertyType, 40)
  const street = readString(req.body?.address?.street, 240)
  const city = readString(req.body?.address?.city, 120)
  const region = readString(req.body?.address?.region || '', 120)
  const postalCode = readString(req.body?.address?.postalCode || '', 24)
  const country = readString(req.body?.address?.country, 40)
  const hotelId = req.body?.id
  const allowedPropertyTypes = ['Hotel', 'Resort', 'Guesthouse', 'Other']

  if (!name || !street || !city) {
    res.status(400).json({ error: 'Enter the hotel name, street address, and city.' })
    return
  }

  if (!allowedPropertyTypes.includes(propertyType)) {
    res.status(400).json({ error: 'Choose a valid property type.' })
    return
  }

  if (region === null || postalCode === null || !['India', 'United States'].includes(country)) {
    res.status(400).json({ error: 'Enter valid hotel address details.' })
    return
  }

  if (hotelId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hotelId)) {
    res.status(400).json({ error: 'The hotel ID is invalid.' })
    return
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const adminResult = await client.query(
      'SELECT firebase_uid FROM admin_users WHERE firebase_uid = $1 FOR UPDATE',
      [req.firebaseUser.uid],
    )

    if (adminResult.rowCount === 0) {
      throw new HttpError(409, 'Save your admin profile before saving hotel details.')
    }

    let result
    if (hotelId) {
      result = await client.query(
        `UPDATE hotels SET
          name = $3,
          property_type = $4,
          street_address = $5,
          city = $6,
          region = $7,
          postal_code = $8,
          country = $9,
          updated_at = NOW()
        WHERE id = $1 AND owner_uid = $2
        RETURNING id::text`,
        [
          hotelId,
          req.firebaseUser.uid,
          name,
          propertyType,
          street,
          city,
          region,
          postalCode,
          country,
        ],
      )

      if (result.rowCount === 0) {
        throw new HttpError(404, 'That hotel could not be found for your account.')
      }
    } else {
      result = await client.query(
        `INSERT INTO hotels (
          owner_uid, name, property_type, street_address, city, region, postal_code, country
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id::text`,
        [
          req.firebaseUser.uid,
          name,
          propertyType,
          street,
          city,
          region,
          postalCode,
          country,
        ],
      )
    }

    const savedHotelId = result.rows[0].id
    await client.query(
      `UPDATE admin_users
       SET primary_hotel_id = $2, updated_at = NOW()
       WHERE firebase_uid = $1`,
      [req.firebaseUser.uid, savedHotelId],
    )
    await client.query('COMMIT')

    res.json({
      hotel: {
        id: savedHotelId,
        name,
        propertyType,
        address: { street, city, region, postalCode, country },
      },
    })
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error('PostgreSQL transaction rollback failed:', rollbackError)
    }

    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message })
      return
    }

    console.error('Could not save PostgreSQL hotel details:', error)
    res.status(500).json({ error: 'Could not save your hotel details.' })
  } finally {
    client.release()
  }
})

app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body must be valid JSON.' })
    return
  }

  console.error('Unhandled API error:', error)
  res.status(500).json({ error: 'The local API encountered an error.' })
})

async function initializeDatabase() {
  const schema = await fs.readFile(path.join(__dirname, 'sql', 'schema.sql'), 'utf8')
  await pool.query(schema)
}

async function startServer() {
  await initializeDatabase()
  app.listen(port, () => {
    console.log(`Hotel management API listening on port ${port}`)
  })
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Could not start the hotel management API:', error)
    process.exitCode = 1
  })
}

module.exports = { app, initializeDatabase, pool }
