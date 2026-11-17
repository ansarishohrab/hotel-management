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
  throw new Error('FIREBASE_PROJECT_ID is required to verify Firebase phone-auth tokens.')
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
    if (!decodedToken.phone_number) {
      res.status(401).json({ error: 'A verified phone number is required.' })
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

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', database: 'connected' })
  } catch (error) {
    console.error('PostgreSQL health check failed:', error)
    res.status(503).json({ status: 'error', database: 'unavailable' })
  }
})

app.get('/api/onboarding', requireFirebaseUser, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        admin.full_name,
        admin.email,
        admin.role,
        admin.phone_number,
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
        phoneNumber: row.phone_number,
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
      `SELECT full_name, email, role, phone_number
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
          phoneNumber: row.phone_number,
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
  const email = readString(req.body?.email || '', 254)
  const role = readString(req.body?.role, 40)
  const allowedRoles = ['Owner', 'General manager', 'Front desk manager', 'Other']

  if (!fullName || fullName.length < 2) {
    res.status(400).json({ error: 'Enter your full name.' })
    return
  }

  if (email === null || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    res.status(400).json({ error: 'Enter a valid email address or leave it blank.' })
    return
  }

  if (!allowedRoles.includes(role)) {
    res.status(400).json({ error: 'Choose a valid admin role.' })
    return
  }

  try {
    await pool.query(
      `INSERT INTO admin_users (firebase_uid, phone_number, full_name, email, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (firebase_uid) DO UPDATE SET
         phone_number = EXCLUDED.phone_number,
         full_name = EXCLUDED.full_name,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         updated_at = NOW()`,
      [
        req.firebaseUser.uid,
        req.firebaseUser.phone_number,
        fullName,
        email || null,
        role,
      ],
    )

    res.json({
      profile: {
        fullName,
        email,
        role,
        phoneNumber: req.firebaseUser.phone_number,
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
