export class ApiError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ApiError'
  }
}

async function requestApi(user, path, options = {}) {
  if (!user) {
    throw new ApiError('Sign in before accessing your saved setup.')
  }

  const token = await user.getIdToken()
  let response

  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiError('Cannot reach the local API. Start the backend and check its PostgreSQL connection.')
    }
    throw error
  }

  if (response.status === 502 || response.status === 504) {
    throw new ApiError('The local API is offline. Start it with npm --prefix backend start.')
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new ApiError(`The local API returned an unexpected response (${response.status}).`)
  }

  let data
  try {
    data = await response.json()
  } catch {
    throw new ApiError('The local API returned an invalid response.')
  }

  if (!response.ok) {
    throw new ApiError(data.error || `The local API request failed (${response.status}).`)
  }

  return data
}

export function getOnboarding(user) {
  return requestApi(user, '/onboarding')
}

export function saveProfile(user, profile) {
  return requestApi(user, '/onboarding/profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  })
}

export function saveHotel(user, hotel) {
  return requestApi(user, '/onboarding/hotel', {
    method: 'PUT',
    body: JSON.stringify(hotel),
  }).then((data) => data.hotel)
}

export function getRooms(user) {
  return requestApi(user, '/rooms')
}

export function createRoom(user, room) {
  return requestApi(user, '/rooms', {
    method: 'POST',
    body: JSON.stringify(room),
  }).then((data) => data.room)
}

export function getBookings(user) {
  return requestApi(user, '/bookings').then((data) => data.bookings)
}

export function createBooking(user, booking) {
  return requestApi(user, '/bookings', {
    method: 'POST',
    body: JSON.stringify(booking),
  }).then((data) => data.booking)
}

export function updateBookingStatus(user, bookingId, status) {
  return requestApi(user, `/bookings/${bookingId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  }).then((data) => data.booking)
}
