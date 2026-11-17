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
